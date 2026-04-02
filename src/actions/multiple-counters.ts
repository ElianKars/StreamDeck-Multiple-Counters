import { action, KeyDownEvent, KeyUpEvent, SingletonAction, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent} from "@elgato/streamdeck";
import { streamDeck } from "@elgato/streamdeck";

// Shared state to keep track of all counters.
const incrementActionIds: Set<string> = new Set<string>();
const backgroundColorPath = "imgs/actions/background/";
const confirmedByContext = new Map<string, NodeJS.Timeout>();   // For reset action confirmation
// Tracks the current press state for each action instance (key). 
// For every pressed key we store:
// - the optional timer for key reset
// - the optional timer for group reset
// - whether the key-reset threshold has already fired
// - whether the group-reset threshold has already fired
// This allows both long-press actions to occur during the same press, 
// while still preventing the normal short-press increment on key release.
const pressStates = new Map<string, PressState>();

// Represents the runtime state of a single key press for one action instance.
// A press can trigger up to two long-press actions:
// - reset only this key
// - reset the whole reset group
type PressState = {
  keyTimer?: NodeJS.Timeout;
  groupTimer?: NodeJS.Timeout;
  keyTriggered: boolean;
  groupTriggered: boolean;
};

/**
 * Sets the title of the action button.
 * @param action - The action instance.
 * @param prefixTitle - Optional prefix for the title.
 * @param count - The current count value.
 * @returns A promise that resolves when the title is set.
 */
function setActionTitle(action: any, prefixTitle: string | undefined, count: number): Promise<void> {
  const title = prefixTitle ? `${prefixTitle}\n${count}` : `${count}`;
  return action.setTitle(title);
}

/**
 * Sets the image of the action button.
 * @param action - The action instance.
 * @param backgroundColor - The background color for the action.
 * @returns A promise that resolves when the image is set.
 */
function setActionImage(action: any, backgroundColor: string | undefined): Promise<void> {
  if (backgroundColor) {
    return action.setImage(`${backgroundColorPath}${backgroundColor}`);
  }
  return Promise.resolve();
}

/**
 * Checks if a value is a valid positive integer.
 * @param v - The value to check.
 * @returns The value if it is a valid positive integer, otherwise undefined.
 */
function toPositiveInt(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
  return undefined;                 // anything else → not a valid hold time
}

/**
 * Converts a value to an integer, returning a fallback value if the conversion fails.
 * @param value - The value to convert.
 * @param fallback - The fallback value to return if the conversion fails.
 * @returns The converted integer or the fallback value.
 */
function toInt(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isInteger(n) ? n : fallback;
}

/**
 * Logs the action details.
 * @param event - The event instance.
 * @param settings - The settings of the action.
 * @param actionType - The type of action being logged.
 */
function logActionDetails(event: any, settings: any, actionType: string): void {
  const payload = event.payload ?? {};

  // Is in multi-action?
  const inMultiAction = payload.isInMultiAction === true;
  // Coordinates only available in top-level actions
  const coords = payload.coordinates as { column: number; row: number } | undefined;

  // Position tag: "[col,row]" for normal keys, "[MA]" for Multi-Action children, "[–]" when no position data
  const pos = coords
    ? `[${coords.column},${coords.row}]`     // bv. [2,0]
    : inMultiAction
      ? "[MA]"                               // Multi Action-child
      : "[–]";                               // Inspector-/global event

  // Log other metadata
  const { prefixTitle, count, resetGroupId, syncGroupId, displayOnly, incdecrementBy, longPressKeyReset, longPressGroupReset} = settings ?? {};

  const uuid = event.actionUUID ?? event.context ?? "unknown";

  streamDeck.logger.trace(
    `Action: ${actionType}, UUID: ${uuid}, Pos: ${pos}, ` +
    `Prefix: ${prefixTitle ?? ""}, Count: ${count ?? ""}, ` +
    `ResetGrp: ${resetGroupId ?? ""}, SyncGrp: ${syncGroupId ?? ""}, ` +
    `DispOnly: ${displayOnly === true ? 1 : 0}, Step: ${incdecrementBy ?? 1}, ` +
    `LPkey: ${longPressKeyReset}, ` +
    `LPgrp: ${longPressGroupReset}`
   );
}

/**
 * Increment Counter Action
 * Each counter has a unique UUID and uses separate settings.
 */
@action({ UUID: "com.github.eliankars.multiple-counters.counter" })
export class IncrementCounter extends SingletonAction<incrementSettings> {
  /**
   * Called when the action appears on the Stream Deck.
   */
  override async onWillAppear(ev: WillAppearEvent<incrementSettings>) {
    const settings = (ev.payload.settings ?? {}) as incrementSettings;
    const uniqueActionId = ev.action.id ?? settings.uniqueActionId;
    const initialValue = toInt(settings.initialValue, 0);
    const count = settings.count ?? initialValue;          // Initialize count with initialValue: if provided, otherwise default to 0
    settings.count = count;
    
    incrementActionIds.add(uniqueActionId);
       
    logActionDetails(ev, settings, "IncrementCounter.onWillAppear");

    // Update the title and image of the button
    setActionImage(ev.action, settings.backgroundColor);
    await setActionTitle(ev.action, settings.prefixTitle ?? "", count);

    await ev.action.setSettings(settings);
  }

  /**
   * Called when the action disappears from the Stream Deck.
   */
  override async onWillDisappear(ev: WillDisappearEvent<incrementSettings>): Promise<void> {
    const id = ev.action.id;
    if (!id) return;

    incrementActionIds.delete(id);

    // Opruimen van eventuele lopende press-state
    const state = pressStates.get(id);
    if (state?.keyTimer) clearTimeout(state.keyTimer);
    if (state?.groupTimer) clearTimeout(state.groupTimer);
    if (state) streamDeck.logger.trace(`Cleaning press state on disappear for action=${id}`);
    pressStates.delete(id);

    logActionDetails(ev, ev.payload.settings ?? {}, "IncrementCounter.onWillDisappear");
  }

 /**
 * Called when the action's key is pressed.
 * Starts up to two independent long-press timers for this key:
 * - one for resetting only this counter
 * - one for resetting all counters in the same resetGroupId
 *
 * Both timers are allowed to fire during the same press.
 * Example:
 * - after 2000 ms → reset only this key
 * - after 3000 ms → reset the whole group
 *
 * If the key is released before either threshold is reached,
 * onKeyUp() will treat it as a normal short press and increment the counter.
 */
override async onKeyDown(ev: KeyDownEvent<incrementSettings>): Promise<void> {
  const ctx = ev.action.id!;
  const settings = (ev.payload.settings ?? {}) as incrementSettings;

  // Clean up any old press state for this key before starting a new press cycle.
  const old = pressStates.get(ctx);
  if (old?.keyTimer) clearTimeout(old.keyTimer);
  if (old?.groupTimer) clearTimeout(old.groupTimer);

  const state: PressState = {
    keyTriggered: false,
    groupTriggered: false,
  };

  // 1) Key-reset timer.
  // Fires once the longPressKeyReset threshold is reached and resets only this counter.
  const keyMs = toPositiveInt(settings.longPressKeyReset);
  if (keyMs) {
    state.keyTimer = setTimeout(async () => {
      // Mark that the key-reset threshold has fired during this press.
      state.keyTriggered = true;
      pressStates.set(ctx, state);
      
      const cur = await ev.action.getSettings<incrementSettings>();
      const resetValue = toInt(cur.initialValue, 0);

      cur.count = resetValue;
      await ev.action.setSettings(cur);
      await setActionTitle(ev.action, cur.prefixTitle, resetValue);
    }, keyMs);
  }

  // 2) Group-reset timer.
  // Fires once the longPressGroupReset threshold is reached and resets all counters
  // that belong to the same resetGroupId.
  const groupMs = toPositiveInt(settings.longPressGroupReset);
  const resetGroupId = (settings.resetGroupId ?? "").trim();

  if (groupMs && resetGroupId !== "") {
    state.groupTimer = setTimeout(async () => {
      // Mark that the group-reset threshold has fired during this press.
      state.groupTriggered = true;
      pressStates.set(ctx, state);

      await resetGroupById(resetGroupId);
    }, groupMs);
  }

  // Store the active press state for this key so onKeyUp() can inspect it later.
  pressStates.set(ctx, state);

  logActionDetails(ev, settings, "IncrementCounter.onKeyDown");
}

/**
 * Called when the action's key is released.
 */
override async onKeyUp(ev: KeyUpEvent<incrementSettings>): Promise<void> {
  const ctx = ev.action.id!;
  const state = pressStates.get(ctx);

  // 1) Stop any timers that are still pending for this press.
  // If a threshold has not been reached yet, releasing the key should prevent it from firing later.
  if (state?.keyTimer) clearTimeout(state.keyTimer);
  if (state?.groupTimer) clearTimeout(state.groupTimer);

  // 2) If one or both long-press actions already fired while the key was still down,
  // this press must NOT perform the normal short-press increment on release.
  if (state?.keyTriggered || state?.groupTriggered) {
    streamDeck.logger.trace(`Short press skipped after long press: ctx=${ctx}, keyTriggered=${state?.keyTriggered ? 1 : 0}, groupTriggered=${state?.groupTriggered ? 1 : 0}`);
    pressStates.delete(ctx);
    return;
  }

  // 3) No long-press threshold fired → this was a normal short press.
  // Remove the stored press state and perform the usual increment action.
  pressStates.delete(ctx);

  // Always read the latest settings here.
  // The count may have changed while the key was held down
  // (for example due to a reset or sync update from another action).
  const settings = await ev.action.getSettings<incrementSettings>();
  const syncGroup = (settings.syncGroupId ?? "").trim();

  // Only increment if not display-only, display-only counters can still be updated 
  // by other counters but won't increment themselves on key press
  if (!settings.displayOnly) {
    const step = toInt(settings.incdecrementBy, 1);
    const current = toInt(settings.count, toInt(settings.initialValue, 0));

    settings.incdecrementBy = step;
    settings.count = current + step;

    await setActionImage(ev.action, settings.backgroundColor);
    await ev.action.setSettings(settings);
    await setActionTitle(ev.action, settings.prefixTitle, settings.count);

    const syncPromises = Array.from(incrementActionIds).map(async id => {
      if (id === ev.action.id) return;

      const a = streamDeck.actions.getActionById(id);
      if (!a) {
        incrementActionIds.delete(id);
        pressStates.delete(id);
        return;
      }

      const s = await a.getSettings<incrementSettings>();

      if ((s.syncGroupId ?? "").trim() === syncGroup && syncGroup !== "") {
        const otherCurrent = toInt(s.count, toInt(s.initialValue, 0));
        s.count = otherCurrent + step;
        await a.setSettings(s);
        await setActionTitle(a, s.prefixTitle, s.count);
      }
    });

    await Promise.all(syncPromises);
  }

  logActionDetails(ev, settings, "IncrementCounter.onKeyUp");
}
  
  /**
   * Called when the action receives new settings.
   */
  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<incrementSettings>): Promise<void> {
    const settings = ev.payload.settings ?? {};
    const count = toInt(settings.count, toInt(settings.initialValue, 0));
    await setActionImage(ev.action, settings.backgroundColor);
    await setActionTitle(ev.action, settings.prefixTitle, count);
    logActionDetails(ev, settings, "IncrementCounter.onDidReceiveSettings");
  }

}

@action({ UUID: "com.github.eliankars.multiple-counters.reset" })
export class ResetCounters extends SingletonAction<resetSettings> {
  /**
   * Called when the action appears on the Stream Deck.
   */
  override onWillAppear(ev: WillAppearEvent<resetSettings>): void | Promise<void> {
    const settings = ev.payload.settings ?? {};
    const idleTitle = settings.idleTitle ?? "";
    setActionImage(ev.action, settings.backgroundColor);
    ev.action.setTitle(idleTitle);
    logActionDetails(ev, settings, "ResetCounters.onWillAppear");
  }

  /**
   * Called when the action disappears from the Stream Deck.
   */
  override async onWillDisappear(ev: WillDisappearEvent<resetSettings>): Promise<void> {
    const ctx = ev.action.id;
    if (!ctx) return;

  const existing = confirmedByContext.get(ctx);
  if (existing) {
    streamDeck.logger.trace(`Cleaning confirm timeout on disappear for ctx=${ctx}`);
    clearTimeout(existing);
    confirmedByContext.delete(ctx);
  }
}

  /**
   * Called when the action's key is pressed.
   */
  override async onKeyDown(ev: KeyDownEvent<resetSettings>): Promise<void> {
    const settings = ev.payload.settings ?? {};
    const ctx = ev.action.id!;
    const confirmReset = settings.confirmReset ?? false;
    const confirmResetWaitTime = toPositiveInt(settings.confirmTimeout) ?? 5000;

    // Check if the the user wants to confirm the reset first else perform the reset action immediately
    if (confirmReset) {
      const existing = confirmedByContext.get(ctx);

      if (!existing) {
        // First press: ask for confirmation
        await ev.action.setTitle(settings.confirmTitle);
        await setActionImage(ev.action, settings.confirmBackgroundColor);
        
        const timeout = setTimeout(() => {
          confirmedByContext.delete(ctx);
          ev.action.setTitle(settings.idleTitle);
          setActionImage(ev.action, settings.backgroundColor);
        }, confirmResetWaitTime);
        
        confirmedByContext.set(ctx, timeout);
        streamDeck.logger.trace(`Reset confirm started: ctx=${ctx}, group=${settings.resetGroupId ?? ""}, timeout=${confirmResetWaitTime}`);
        return;
      } else {
          clearTimeout(existing);
          confirmedByContext.delete(ctx);
          await ev.action.setTitle(settings.idleTitle);
          await setActionImage(ev.action, settings.backgroundColor);
          streamDeck.logger.trace(`Reset confirm expired: ctx=${ctx}, group=${settings.resetGroupId ?? ""}`);
      }
    }

    // Perform the reset, reset all counters with the same resetGroupId to 0
    const resetGroupId = (settings.resetGroupId ?? "").trim();
    if (resetGroupId !== "") {
      await resetGroupById(resetGroupId);
    }

    logActionDetails(ev, settings, "ResetCounters.onKeyDown");
  }

  /**
   * Called when the action receives new settings.
   */
  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<resetSettings>): Promise<void> {
    const settings = ev.payload.settings ?? {};
    const idleTitle = settings.idleTitle ?? "";

    await setActionImage(ev.action, settings.backgroundColor);
    await ev.action.setTitle(idleTitle);
    logActionDetails(ev, settings, "ResetCounters.onDidReceiveSettings");
  }
}

/**
 * Resets all counters with the specified group ID to zero.
 */
async function resetGroupById(groupId: string): Promise<void> {
  const resetPromises = Array.from(incrementActionIds).map(async (otherId) => {
    const a = streamDeck.actions.getActionById(otherId);

    // If the action no longer exists, clean up its ID from our shared state and skip it.
    if (!a) {
      incrementActionIds.delete(otherId);
      pressStates.delete(otherId);
      return;
    }

    const os = await a.getSettings<incrementSettings>();
    if ((os.resetGroupId ?? "").trim() === groupId) {
      const resetValue = toInt(os.initialValue, 0);
      os.count = resetValue;
      await a.setSettings(os);
      await setActionTitle(a, os.prefixTitle, resetValue);
    }
  });

  await Promise.all(resetPromises);
}

/**
 * Settings for the IncrementCounter action.
 */
type incrementSettings = {
  prefixTitle?: string;         // Optional prefix for the title
  count?: number;               // Current count value
  initialValue?: number;        // Initial value for the counter
  incdecrementBy?: number;      // Value to increment/decrement by
  uniqueActionId?: string;      // Unique identifier for the action
  syncGroupId?: string;         // Counters with the same syncGroupId will be synchronized
  resetGroupId?: string;        // Counters with the same resetGroupId can be reset together
  displayOnly?: boolean;        // Whether the counter is display-only
  backgroundColor?: string;     // Background color for the action
  longPressKeyReset?: number;  // Time in milliseconds to reset the current key on long press
  longPressGroupReset?: number; // Time in milliseconds to reset all counters in the same resetGroupId on long press
};

/**
 * Settings for the ResetCounters action.
 */
type resetSettings = {
  idleTitle?: string;               // Title when idle, normal title
  resetGroupId?: string;            // Only counters with the same resetGroupId will be reset
  backgroundColor?: string;         // Background color for the action
  confirmReset?: boolean;           // Whether to confirm reset
  confirmTitle: string;             // Title for confirmation
  confirmTimeout?: number;          // Timeout for confirmation in seconds
  confirmBackgroundColor?: string;  // Background color for confirmation
};
