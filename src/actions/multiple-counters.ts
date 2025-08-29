import { action, KeyDownEvent, KeyUpEvent, SingletonAction, WillAppearEvent, DidReceiveSettingsEvent } from "@elgato/streamdeck";
import { streamDeck, JsonValue } from "@elgato/streamdeck";

// Shared state to keep track of all counters.
const incrementActionIds: Set<string> = new Set<string>();
const backgroundColorPath = "imgs/actions/background/";
let confirmed = false;                        // For reset action confirmation

const longPressTimers = new Map<string, {     // Keeps track of the two possible reset timers
  key?: NodeJS.Timeout;                       // fires → reset *this* counter
  group?: NodeJS.Timeout;                     // fires → reset *all* counters in same resetGroupId
}>();

// Set of context-ids (keys) for which *one* of the timers has already executed. User can press multiple keys.
// Tells onKeyUp() that a long-press action has happened, so it must *skip* the normal +1 because we want to reset instead.
const longPressHandled = new Set<string>();

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


// Convert user input to a positive integer in ms, or return undefined if invalid.
// Accepts "2000", 2000   ✔              Accepts "2.5", "-1", "abc"   ✘
function isValidPosNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
  return undefined;                 // anything else → not a valid hold time
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
  const { prefixTitle, count, resetGroupId, syncGroupId, displayOnly, incrementBy, longPressKeyReset, longPressGroupReset} = settings ?? {};

  const uuid = event.actionUUID ?? event.context ?? "unknown";

  streamDeck.logger.trace(
    `Action: ${actionType}, UUID: ${uuid}, Pos: ${pos}, ` +
    `Prefix: ${prefixTitle ?? ""}, Count: ${count ?? ""}, ` +
    `ResetGrp: ${resetGroupId ?? ""}, SyncGrp: ${syncGroupId ?? ""}, ` +
    `Action: ${actionType}, UUID: ${uuid}, Pos: ${pos}, ` +
    `Prefix: ${prefixTitle ?? ""}, Count: ${count ?? ""}, ` +
    `ResetGrp: ${resetGroupId ?? ""}, SyncGrp: ${syncGroupId ?? ""}, ` +
    `DispOnly: ${displayOnly === true ? 1 : 0}, Step: ${incrementBy ?? 1}, ` +
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
  override onWillAppear(ev: WillAppearEvent<incrementSettings>): void | Promise<void> {
    const settings = (ev.payload.settings ?? {}) as incrementSettings;
    const uniqueActionId = ev.action.id ?? settings.uniqueActionId;
    const count = settings.count ?? 0;
    const prefixTitle = settings.prefixTitle ?? "";

    incrementActionIds.add(uniqueActionId);
    
    logActionDetails(ev, settings, "IncrementCounter.onWillAppear");

    // Update the title and image of the button
    setActionImage(ev.action, settings.backgroundColor);
    setActionTitle(ev.action, prefixTitle, count);
  }

  /**
   * Called when the action's key is pressed.
   * The timer with the shortest configured hold time fires first. If that’s the **group-reset**, the key-reset callback will notice
   * `longPressHandled` is already set and will do nothing. If that’s the **key-reset**, this group-reset timer will be cleared
   * later in `onKeyUp` without ever executing.
   */
  override async onKeyDown(ev: KeyDownEvent<incrementSettings>): Promise<void> {
    const ctx = ev.action.id!;                                      // context ID of this action instance
    const s   = (ev.payload.settings ?? {}) as incrementSettings;

    // 1) Start a group-reset timer. This timer is only created if a resetGroupId is set.
    if (isValidPosNumber(s.longPressGroupReset) && (s.resetGroupId ?? "").trim() !== "") {
      const tGrp = setTimeout(async () => {
        await resetGroupById(s.resetGroupId!);
        longPressHandled.add(ctx);                                  // mark as handled, so onKeyUp() will skip normal +1
        longPressTimers.delete(ctx);                                // remove all timers for this context
      }, s.longPressGroupReset);                                    // optionele feedback, bv. await ev.action.setTitle("🔄");

      longPressTimers.set(ctx, { group: tGrp });
    }

    // 2) Key-reset timer. This timer is always created. It might run before or after the group-timer.
    if (isValidPosNumber(s.longPressKeyReset)) {
      const tKey = setTimeout(async () => {
      if (longPressHandled.has(ctx)) return;                           // exit, group-reset already happened
      const cur = await ev.action.getSettings<incrementSettings>();
      cur.count = 0;
      await ev.action.setSettings(cur);
      await setActionTitle(ev.action, cur.prefixTitle, 0);
      longPressHandled.add(ctx);                                       // mark as handled    
      longPressTimers.delete(ctx);                                     // and remove all timers for this context   
    }, s.longPressKeyReset);                              

      // Update (or create) the timer record for this context: `longPressTimers` may already contain the *group-reset* timer.
      // We add the *key-reset* timer (`tKey`) to that same record, so both timers for this tile are tracked together in one place.
      const timers = longPressTimers.get(ctx) ?? {};
      timers.key = tKey;
      longPressTimers.set(ctx, timers);
  }
    logActionDetails(ev, s, "IncrementCounter.onKeyDown");
  }

/**
* Called when the action's key is released.
*/
override async onKeyUp(ev: KeyUpEvent<incrementSettings>): Promise<void> {
  const ctx        = ev.action.id!;
  const settings   = (ev.payload.settings ?? {}) as incrementSettings;
  const syncGroup  = settings.syncGroupId ?? "default";

  // 1) Did a timer already fire while the key was still down?
  if (longPressHandled.delete(ctx)) return;
  
  // 2) No timer fired → This was a short press → Cancel both timers still pending
  const t = longPressTimers.get(ctx);
  if (t?.key)   clearTimeout(t.key);
  if (t?.group) clearTimeout(t.group);
  longPressTimers.delete(ctx);

  // 3) Usual increment action
  if (!settings.displayOnly) {
    settings.incrementBy ??= 1;
    settings.count = (settings.count ?? 0) + settings.incrementBy;

    await setActionImage(ev.action, settings.backgroundColor);
    await ev.action.setSettings(settings);
    await setActionTitle(ev.action, settings.prefixTitle, settings.count);

    const syncPromises = Array.from(incrementActionIds).map(async id => {
      if (id === ev.action.id) return;               // skip self
      const a = streamDeck.actions.getActionById(id)!;
      const s = await a.getSettings<incrementSettings>();
      if (s.syncGroupId === syncGroup) {
        s.count = (s.count ?? 0) + settings.incrementBy!;
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

    await setActionImage(ev.action, settings.backgroundColor);
    await setActionTitle(ev.action, settings.prefixTitle, settings.count ?? 0);
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
   * Called when the action's key is pressed.
   */
  override async onKeyDown(ev: KeyDownEvent<resetSettings>): Promise<void> {
    const settings = ev.payload.settings ?? {};
    const confirmReset = settings.confirmReset ?? false;
    const confirmResetWaitTime = (settings.confirmTimeout ?? 5) * 1000;

    // Check if the the user wants to confirm the reset first else perform the reset action immediately
    if (confirmReset) {
      if (!confirmed) {
        // First press: ask for confirmation
        confirmed = true;
        await ev.action.setTitle(settings.confirmTitle);
        await setActionImage(ev.action, settings.confirmBackgroundColor);
        setTimeout(() => {
            confirmed = false;
            ev.action.setTitle(settings.idleTitle);
            setActionImage(ev.action, settings.backgroundColor);
        }, confirmResetWaitTime); // Reset after specified wait time
        return;
      } else {
        // Second press: perform the action
        confirmed = false;
        await ev.action.setTitle(settings.idleTitle);
        await setActionImage(ev.action, settings.backgroundColor);
      }
    }

    // Perform the reset, reset all counters with the same resetGroupId to 0
    const resetGroupId = (settings.resetGroupId?.trim() || "default");
    await resetGroupById(resetGroupId);

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
    logActionDetails(ev, settings, "IncrementCounter.onDidReceiveSettings");
  }
}

/**
 * Resets all counters with the specified group ID to zero.
 */
async function resetGroupById(groupId: string): Promise<void> {
  const resetPromises = Array.from(incrementActionIds).map(async (otherId) => {
    const a = streamDeck.actions.getActionById(otherId)!;
    const os = await a.getSettings<incrementSettings>();
    if (os.resetGroupId === groupId) {
      os.count = 0;
      await a.setSettings(os);
      await setActionTitle(a, os.prefixTitle, 0);
    }
  });
  await Promise.all(resetPromises);
}

function getUniqueActionId(
  ev: { action: { id?: string } },
  settings: { uniqueActionId?: string }
): string {
  return ev.action.id ?? settings.uniqueActionId ?? "";
}

/**
 * Settings for the IncrementCounter action.
 */
type incrementSettings = {
  prefixTitle?: string;         // Optional prefix for the title
  count?: number;               // Current count value
  incrementBy?: number;         // Value to increment by
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
