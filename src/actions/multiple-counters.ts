import { action, KeyDownEvent, SingletonAction, WillAppearEvent, DidReceiveSettingsEvent } from "@elgato/streamdeck";
import { streamDeck, JsonValue } from "@elgato/streamdeck";

/**
 * Shared state to keep track of all counters.
 */
const incrementActionIds: Set<string> = new Set<string>();
const backgroundColorPath = "imgs/actions/background/";
let confirmed = false;

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
 * Logs the action details.
 * @param event - The event instance.
 * @param settings - The settings of the action.
 * @param actionType - The type of action being logged.
 */
function logActionDetails(event: any, settings: any, actionType: string): void {
  const { column, row } = event.payload.coordinates;
  const { prefixTitle, count, sharedId } = settings;
  const actionUUID = event.actionUUID;
  streamDeck.logger.trace(`Action: ${actionType}, UUID: ${actionUUID}, Position: (${column}, ${row}), Prefix Title: ${prefixTitle}, Count: ${count}, Shared ID: ${sharedId}`);
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
    const settings = ev.payload.settings ?? {};
    const count = settings.count ?? 0;
    const prefixTitle = settings.prefixTitle ?? "";
    const uniqueActionId = ev.action.id ?? "unknown-uniqueActionId";

    incrementActionIds.add(uniqueActionId);
    
    // Update the title and image of the button
    setActionImage(ev.action, settings.backgroundColor);
    setActionTitle(ev.action, prefixTitle, count);
    logActionDetails(ev, settings, "IncrementCounter.onWillAppear");
  }

  /**
   * Called when the action's key is pressed.
   */
  override async onKeyDown(ev: KeyDownEvent<incrementSettings>): Promise<void> {
    const uniqueActionId = ev.action.id ?? "unknown-uniqueActionId";
    const settings = ev.payload.settings ?? {};
    
    settings.incrementBy ??= 1;
    settings.count = (settings.count ?? 0) + settings.incrementBy;
    
    // Update both the action settings and the global state
    await setActionImage(ev.action, settings.backgroundColor);
    await ev.action.setSettings(settings);
    await setActionTitle(ev.action, settings.prefixTitle, settings.count);
    logActionDetails(ev, settings, "IncrementCounter.onKeyDown");
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
    const initialTitle = settings.initialTitle ?? "";
    setActionImage(ev.action, settings.backgroundColor);
    ev.action.setTitle(initialTitle);
    logActionDetails(ev, settings, "ResetCounters.onWillAppear");
  }

  /**
   * Called when the action's key is pressed.
   */
  override async onKeyDown(ev: KeyDownEvent<resetSettings>): Promise<void> {
    const settings = ev.payload.settings ?? {};
    const confirmReset = settings.confirmReset ?? false;
    const confirmResetWaitTime = (settings.confirmResetWaitTime ?? 5) * 1000;

    // Check if the the user wants to confirm the reset first else perform the reset action immediately
    if (confirmReset) {
      if (!confirmed) {
        // First press: ask for confirmation
        confirmed = true;
        await ev.action.setTitle(settings.confirmTitle);
        await setActionImage(ev.action, settings.confirmBackgroundColor);
        setTimeout(() => {
            confirmed = false;
            ev.action.setTitle(settings.initialTitle);
            setActionImage(ev.action, settings.backgroundColor);
        }, confirmResetWaitTime); // Reset after specified wait time
        return;
      } else {
        // Second press: perform the action
        confirmed = false;
        await ev.action.setTitle(settings.initialTitle);
        await setActionImage(ev.action, settings.backgroundColor);
      }
    }

    // Perform the reset, reset all counters with the same sharedId to 0
    const targetSharedId = settings.targetSharedId ?? "default";
    const resetPromises = Array.from(incrementActionIds).map(async (uniqueActionId) => {
    const action = streamDeck.actions.getActionById(uniqueActionId)!;                       // Non-null assertion operator used to ensure action is not undefined
    const incSettings = await action.getSettings<incrementSettings>() as incrementSettings; // Type assertion to specify the type of settings

      if (targetSharedId == incSettings.sharedId && incSettings) {
        incSettings.count = 0; // Reset the counter
        await action.setSettings(incSettings);
        await setActionTitle(action, incSettings.prefixTitle, 0);
      }
    });
    await Promise.all(resetPromises);
    logActionDetails(ev, settings, "ResetCounters.onKeyDown");
  }

  /**
   * Called when the action receives new settings.
   */
  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<resetSettings>): Promise<void> {
    const settings = ev.payload.settings ?? {};
    const initialTitle = settings.initialTitle ?? "";

    await setActionImage(ev.action, settings.backgroundColor);
    await ev.action.setTitle(initialTitle);
    logActionDetails(ev, settings, "IncrementCounter.onDidReceiveSettings");
  }
}

/**
 * Settings for the IncrementCounter action.
 */
type incrementSettings = {
  gotInitialTitle?: boolean;  // Whether the initial title has been set
  prefixTitle?: string;       // Optional prefix for the title
  count?: number;             // Current count value
  incrementBy?: number;       // Value to increment by
  uniqueActionId?: string;    // Unique identifier for the action
  sharedId?: string;          // Counters with the same sharedId can be reset together
  backgroundColor?: string;   // Background color for the action
};

/**
 * Settings for the ResetCounters action.
 */
type resetSettings = {
  initialTitle?: string;            // Initial title before reset confirmation
  targetSharedId?: string;          // Only counters with the same sharedId will be reset
  backgroundColor?: string;         // Background color for the action
  confirmReset?: boolean;           // Whether to confirm reset
  confirmTitle: string;             // Title for confirmation
  confirmResetWaitTime?: number;    // Wait time for reset confirmation
  confirmBackgroundColor?: string;  // Background color for confirmation
};
