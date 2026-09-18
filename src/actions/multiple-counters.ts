import {
  action,
  DidReceiveSettingsEvent,
  KeyDownEvent,
  KeyUpEvent,
  PropertyInspectorDidAppearEvent,
  PropertyInspectorDidDisappearEvent,
  SendToPluginEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
} from "@elgato/streamdeck";
import { streamDeck } from "@elgato/streamdeck";
import { writeFile } from "node:fs/promises";

// Shared state to keep track of all counters.
const counterActionIds = new Set<string>();
const backgroundColorPath = "imgs/actions/background/";
const maxTimerDuration = 2_147_483_647;
const confirmedByContext = new Map<string, NodeJS.Timeout>();
const pressStates = new Map<string, PressState>();
const counterFileWrites = new Map<string, Promise<void>>();
const counterFileWriteErrors = new Map<string, string>();
const activeFileOutputConfigurations = new Map<string, FileOutputConfiguration>();
const fileOutputDrafts = new Map<string, FileOutputConfiguration>();
const openPropertyInspectors = new Set<string>();

// Runtime state for one physical press. Reset timers remain independent, while
// the short-press and hold changes are selected exclusively on keyUp.
type PressState = {
  pressedAt: number;
  holdChangeMs?: number;
  holdChangeBy?: number;
  keyResetMs?: number;
  groupResetMs?: number;
  resetGroupId: string;
  keyTimer?: NodeJS.Timeout;
  groupTimer?: NodeJS.Timeout;
  keyResetPromise?: Promise<void>;
  groupResetPromise?: Promise<void>;
  keyTriggered: boolean;
  groupTriggered: boolean;
};

type FileOutputConfiguration = {
  enabled: boolean;
  path: string;
};

type FileOutputDraftMessage = {
  event: "fileOutputDraftChanged";
  writeToFileEnabled: boolean;
  filePath: string;
};

/** Sets the title of an action button. */
function setActionTitle(action: any, prefixTitle: string | undefined, count: number): Promise<void> {
  const title = prefixTitle ? `${prefixTitle}\n${count}` : `${count}`;
  return action.setTitle(title);
}

/** Sets the image of an action button. */
function setActionImage(action: any, backgroundColor: string | undefined): Promise<void> {
  if (backgroundColor) {
    return action.setImage(`${backgroundColorPath}${backgroundColor}`);
  }
  return Promise.resolve();
}

/** Parses a positive integer used as a hold duration. */
function toPositiveInt(value: unknown): number | undefined {
  const parsed = toOptionalInt(value);
  return parsed !== undefined && parsed > 0 && parsed <= maxTimerDuration
    ? parsed
    : undefined;
}

/** Parses an integer without treating an empty string as zero. */
function toOptionalInt(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? value : undefined;
  }

  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }

  return undefined;
}

/** Converts a value to an integer, returning a fallback if parsing fails. */
function toInt(value: unknown, fallback = 0): number {
  return toOptionalInt(value) ?? fallback;
}

/** Reads the new short-press setting, with the pre-update key as fallback. */
function getShortPressChangeBy(settings: CounterSettings): number {
  const configuredValue =
    settings.shortPressChangeBy !== undefined
      ? settings.shortPressChangeBy
      : settings.incdecrementBy;
  return toInt(configuredValue, 1);
}

/**
 * Existing profiles used Display-only to suppress normal key presses. Treat
 * that legacy setting as the inverse of the new short-press switch until the
 * Property Inspector has persisted the replacement setting.
 */
function isShortPressChangeEnabled(settings: CounterSettings): boolean {
  if (typeof settings.shortPressChangeEnabled === "boolean") {
    return settings.shortPressChangeEnabled;
  }

  return settings.displayOnly !== true;
}

/** Reads hold-change settings, including the names used by a pre-release build. */
function isHoldChangeEnabled(settings: CounterSettings): boolean {
  if (typeof settings.holdChangeEnabled === "boolean") {
    return settings.holdChangeEnabled;
  }

  return settings.holdToDecrementEnabled === true;
}

function getHoldChangeBy(settings: CounterSettings): unknown {
  return settings.holdChangeBy !== undefined
    ? settings.holdChangeBy
    : settings.holdToDecrementBy;
}

function getHoldChangeDuration(settings: CounterSettings): unknown {
  return settings.holdChangeDuration !== undefined
    ? settings.holdChangeDuration
    : settings.holdToDecrementDuration;
}

/**
 * Old profiles only stored a reset duration. If the new enabled setting is
 * absent, a valid legacy duration still enables that reset.
 */
function isResetEnabled(enabled: boolean | undefined, duration: unknown): boolean {
  return typeof enabled === "boolean" ? enabled : toPositiveInt(duration) !== undefined;
}

/** Writes one counter value, serializing writes per action to preserve order. */
async function writeCounterValue(
  actionId: string,
  configuration: FileOutputConfiguration,
  count: number,
): Promise<void> {
  if (!configuration.enabled) return;

  const outputPath = configuration.path;
  if (outputPath === "") return;

  const previousWrite = counterFileWrites.get(actionId) ?? Promise.resolve();
  const currentWrite = previousWrite.then(async () => {
    try {
      await writeFile(outputPath, String(count), "utf8");
      counterFileWriteErrors.delete(actionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorKey = `${outputPath}\0${message}`;

      // Keep a persistent path problem visible without repeating the same
      // error after every counter update. A successful write clears it.
      if (counterFileWriteErrors.get(actionId) !== errorKey) {
        counterFileWriteErrors.set(actionId, errorKey);
        streamDeck.logger.error(
          `Unable to write counter value for action=${actionId} to ${JSON.stringify(outputPath)}: ${message}`,
        );
      }
    }
  });

  counterFileWrites.set(actionId, currentWrite);
  await currentWrite;

  if (counterFileWrites.get(actionId) === currentWrite) {
    counterFileWrites.delete(actionId);
  }
}

function getFileOutputConfiguration(settings: CounterSettings): FileOutputConfiguration {
  const outputPath = typeof settings.filePath === "string" ? settings.filePath.trim() : "";
  return {
    enabled: settings.writeToFileEnabled === true,
    path: outputPath,
  };
}

function getFileOutputDraftConfiguration(settings: CounterSettings): FileOutputConfiguration {
  const draftPath =
    typeof settings.filePathDraft === "string"
      ? settings.filePathDraft.trim()
      : getFileOutputConfiguration(settings).path;
  return {
    enabled: settings.writeToFileEnabled === true,
    path: draftPath,
  };
}

function hasSameFileOutputConfiguration(
  first: FileOutputConfiguration | undefined,
  second: FileOutputConfiguration,
): boolean {
  return first?.enabled === second.enabled && first.path === second.path;
}

/**
 * Activates file-output settings and writes once when that configuration
 * changed. While the Property Inspector is open, its draft is deliberately not
 * activated so partial paths can never receive counter output.
 */
async function activateFileOutputConfiguration(
  action: any,
  configuration: FileOutputConfiguration,
  count: number,
): Promise<void> {
  const actionId = action.id;
  const previousConfiguration = activeFileOutputConfigurations.get(actionId);
  if (hasSameFileOutputConfiguration(previousConfiguration, configuration)) return;

  activeFileOutputConfigurations.set(actionId, configuration);
  counterFileWriteErrors.delete(actionId);
  await writeCounterValue(actionId, configuration, count);
}

/** Persists and displays one counter value, including optional file output. */
async function setCounterValue(
  action: any,
  settings: CounterSettings,
  count: number,
  updateImage = false,
): Promise<void> {
  settings.count = count;
  await action.setSettings(settings);
  if (updateImage) await setActionImage(action, settings.backgroundColor);
  await setActionTitle(action, settings.prefixTitle, count);

  const configuration =
    activeFileOutputConfigurations.get(action.id) ?? getFileOutputConfiguration(settings);
  activeFileOutputConfigurations.set(action.id, configuration);
  void writeCounterValue(action.id, configuration, count);
}

/** Applies a delta to one counter and every counter in its sync group. */
async function changeCounterAndSync(
  action: any,
  settings: CounterSettings,
  step: number,
): Promise<void> {
  const syncGroup = (settings.syncGroupId ?? "").trim();
  const current = toInt(settings.count, toInt(settings.initialValue, 0));

  await setCounterValue(action, settings, current + step, true);

  const syncPromises = Array.from(counterActionIds).map(async (id) => {
    if (id === action.id) return;

    const otherAction = streamDeck.actions.getActionById(id);
    if (!otherAction || !otherAction.isKey()) {
      counterActionIds.delete(id);
      pressStates.delete(id);
      return;
    }

    const otherSettings = await otherAction.getSettings<CounterSettings>();
    if (syncGroup !== "" && (otherSettings.syncGroupId ?? "").trim() === syncGroup) {
      const otherCurrent = toInt(
        otherSettings.count,
        toInt(otherSettings.initialValue, 0),
      );
      await setCounterValue(otherAction, otherSettings, otherCurrent + step);
    }
  });

  await Promise.all(syncPromises);
}

/** Clears timers that have not fired yet for a press. */
function clearPressTimers(state: PressState | undefined): void {
  if (state?.keyTimer) clearTimeout(state.keyTimer);
  if (state?.groupTimer) clearTimeout(state.groupTimer);
  if (state) {
    state.keyTimer = undefined;
    state.groupTimer = undefined;
  }
}

/** Runs the per-key reset once for a press. */
function triggerKeyReset(ctx: string, state: PressState, action: any): Promise<void> {
  if (state.keyTriggered) return state.keyResetPromise ?? Promise.resolve();

  state.keyTriggered = true;
  state.keyResetPromise = (async () => {
    try {
      const settings = (await action.getSettings()) as CounterSettings;
      const resetValue = toInt(settings.initialValue, 0);
      await setCounterValue(action, settings, resetValue);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      streamDeck.logger.error(`Unable to reset counter action=${ctx}: ${message}`);
    }
  })();

  return state.keyResetPromise;
}

/** Runs the reset-group action once for a press. */
function triggerGroupReset(ctx: string, state: PressState): Promise<void> {
  if (state.groupTriggered) return state.groupResetPromise ?? Promise.resolve();

  state.groupTriggered = true;
  state.groupResetPromise = (async () => {
    try {
      await resetGroupById(state.resetGroupId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      streamDeck.logger.error(
        `Unable to reset group ${JSON.stringify(state.resetGroupId)} from action=${ctx}: ${message}`,
      );
    }
  })();

  return state.groupResetPromise;
}

/** Logs action details at trace level. */
function logActionDetails(event: any, settings: any, actionType: string): void {
  const payload = event.payload ?? {};
  const inMultiAction = payload.isInMultiAction === true;
  const coords = payload.coordinates as { column: number; row: number } | undefined;
  const pos = coords ? `[${coords.column},${coords.row}]` : inMultiAction ? "[MA]" : "[–]";

  const {
    prefixTitle,
    count,
    resetGroupId,
    syncGroupId,
    shortPressChangeBy,
    longPressKeyResetEnabled,
    longPressKeyReset,
    longPressGroupResetEnabled,
    longPressGroupReset,
    writeToFileEnabled,
  } = settings ?? {};
  const configuredShortPressChangeBy =
    shortPressChangeBy ?? settings?.incdecrementBy ?? 1;
  const shortPressChangeEnabled = isShortPressChangeEnabled(settings ?? {});
  const holdChangeEnabled = isHoldChangeEnabled(settings ?? {});
  const holdChangeBy = getHoldChangeBy(settings ?? {});
  const holdChangeDuration = getHoldChangeDuration(settings ?? {});
  const uuid = event.actionUUID ?? event.context ?? "unknown";

  streamDeck.logger.trace(
    `Action: ${actionType}, UUID: ${uuid}, Pos: ${pos}, ` +
      `Prefix: ${prefixTitle ?? ""}, Count: ${count ?? ""}, ` +
      `ResetGrp: ${resetGroupId ?? ""}, SyncGrp: ${syncGroupId ?? ""}, ` +
      `ShortChange: ${shortPressChangeEnabled ? 1 : 0}/${configuredShortPressChangeBy}, ` +
      `HoldChange: ${holdChangeEnabled === true ? 1 : 0}/${holdChangeBy ?? ""}/${holdChangeDuration ?? ""}, ` +
      `LPkey: ${longPressKeyResetEnabled ?? "legacy"}/${longPressKeyReset ?? ""}, ` +
      `LPgrp: ${longPressGroupResetEnabled ?? "legacy"}/${longPressGroupReset ?? ""}, ` +
      `File: ${writeToFileEnabled === true ? 1 : 0}`,
  );
}

/** Counter Action. Each counter has separate persisted settings. */
@action({ UUID: "com.github.eliankars.multiple-counters.counter" })
export class CounterAction extends SingletonAction<CounterSettings> {
  override async onWillAppear(ev: WillAppearEvent<CounterSettings>): Promise<void> {
    const settings = (ev.payload.settings ?? {}) as CounterSettings;
    const initialValue = toInt(settings.initialValue, 0);
    const count = toInt(settings.count, initialValue);

    counterActionIds.add(ev.action.id);
    activeFileOutputConfigurations.set(
      ev.action.id,
      getFileOutputConfiguration(settings),
    );
    logActionDetails(ev, settings, "CounterAction.onWillAppear");

    await setActionImage(ev.action, settings.backgroundColor);
    await setCounterValue(ev.action, settings, count);
  }

  override async onWillDisappear(
    ev: WillDisappearEvent<CounterSettings>,
  ): Promise<void> {
    const id = ev.action.id;
    if (!id) return;

    counterActionIds.delete(id);
    activeFileOutputConfigurations.delete(id);
    fileOutputDrafts.delete(id);
    openPropertyInspectors.delete(id);
    counterFileWriteErrors.delete(id);
    const state = pressStates.get(id);
    clearPressTimers(state);
    if (state) {
      streamDeck.logger.trace(`Cleaning press state on disappear for action=${id}`);
    }
    pressStates.delete(id);

    logActionDetails(ev, ev.payload.settings ?? {}, "CounterAction.onWillDisappear");
  }

  /** Starts the two independent reset timers and records the press timestamp. */
  override async onKeyDown(ev: KeyDownEvent<CounterSettings>): Promise<void> {
    const ctx = ev.action.id;
    const settings = (ev.payload.settings ?? {}) as CounterSettings;

    clearPressTimers(pressStates.get(ctx));

    const resetGroupId = (settings.resetGroupId ?? "").trim();
    const keyResetMs = isResetEnabled(
      settings.longPressKeyResetEnabled,
      settings.longPressKeyReset,
    )
      ? toPositiveInt(settings.longPressKeyReset)
      : undefined;
    const groupResetMs =
      isResetEnabled(settings.longPressGroupResetEnabled, settings.longPressGroupReset) &&
      resetGroupId !== ""
        ? toPositiveInt(settings.longPressGroupReset)
        : undefined;
    const holdChangeEnabled = isHoldChangeEnabled(settings);
    const holdChangeMs = holdChangeEnabled
      ? toPositiveInt(getHoldChangeDuration(settings))
      : undefined;

    const state: PressState = {
      pressedAt: Date.now(),
      holdChangeMs,
      holdChangeBy: holdChangeEnabled
        ? toOptionalInt(getHoldChangeBy(settings))
        : undefined,
      keyResetMs,
      groupResetMs,
      resetGroupId,
      keyTriggered: false,
      groupTriggered: false,
    };

    if (keyResetMs !== undefined) {
      state.keyTimer = setTimeout(() => {
        state.keyTimer = undefined;
        void triggerKeyReset(ctx, state, ev.action);
      }, keyResetMs);
    }

    if (groupResetMs !== undefined) {
      state.groupTimer = setTimeout(() => {
        state.groupTimer = undefined;
        void triggerGroupReset(ctx, state);
      }, groupResetMs);
    }

    pressStates.set(ctx, state);
    logActionDetails(ev, settings, "CounterAction.onKeyDown");
  }

  /** Selects resets first, then exactly one count action, based on total duration. */
  override async onKeyUp(ev: KeyUpEvent<CounterSettings>): Promise<void> {
    const ctx = ev.action.id;
    const state = pressStates.get(ctx);
    clearPressTimers(state);
    const pressDuration = state ? Math.max(0, Date.now() - state.pressedAt) : 0;

    try {
      if (state) {
        // Catch up reset callbacks that were due but had not run yet because of
        // event-loop scheduling. Each trigger function is idempotent per press.
        if (state.keyResetMs !== undefined && pressDuration >= state.keyResetMs) {
          await triggerKeyReset(ctx, state, ev.action);
        } else if (state.keyResetPromise) {
          await state.keyResetPromise;
        }

        if (state.groupResetMs !== undefined && pressDuration >= state.groupResetMs) {
          await triggerGroupReset(ctx, state);
        } else if (state.groupResetPromise) {
          await state.groupResetPromise;
        }

        if (state.keyTriggered || state.groupTriggered) {
          streamDeck.logger.trace(
            `Count change skipped after reset: ctx=${ctx}, duration=${pressDuration}, ` +
              `keyTriggered=${state.keyTriggered ? 1 : 0}, groupTriggered=${state.groupTriggered ? 1 : 0}`,
          );
          return;
        }
      }

      // Read the latest value in case this counter changed while the key was held.
      const settings = await ev.action.getSettings<CounterSettings>();
      const useHoldChange =
        state?.holdChangeMs !== undefined && pressDuration >= state.holdChangeMs;

      if (useHoldChange && state.holdChangeBy === undefined) {
        streamDeck.logger.warn(
          `Hold change skipped because Change by is not a valid integer: action=${ctx}`,
        );
      } else if (useHoldChange) {
        await changeCounterAndSync(ev.action, settings, state.holdChangeBy!);
      } else if (isShortPressChangeEnabled(settings)) {
        await changeCounterAndSync(ev.action, settings, getShortPressChangeBy(settings));
      }

      logActionDetails(ev, settings, "CounterAction.onKeyUp");
    } finally {
      // Do not delete a newer press if another keyDown arrived while async work
      // for this release was still completing.
      if (!state || pressStates.get(ctx) === state) {
        pressStates.delete(ctx);
      }
    }
  }

  override async onDidReceiveSettings(
    ev: DidReceiveSettingsEvent<CounterSettings>,
  ): Promise<void> {
    const settings = ev.payload.settings ?? {};
    const count = toInt(settings.count, toInt(settings.initialValue, 0));
    await setActionImage(ev.action, settings.backgroundColor);
    await setActionTitle(ev.action, settings.prefixTitle, count);

    // sdpi-components persists text fields while the user types. Keep those
    // settings as a draft until the Property Inspector closes, so neither a
    // pause nor a counter press can activate an incomplete path.
    if (!openPropertyInspectors.has(ev.action.id)) {
      await activateFileOutputConfiguration(
        ev.action,
        getFileOutputConfiguration(settings),
        count,
      );
    }

    logActionDetails(ev, settings, "CounterAction.onDidReceiveSettings");
  }

  override async onPropertyInspectorDidAppear(
    ev: PropertyInspectorDidAppearEvent<CounterSettings>,
  ): Promise<void> {
    openPropertyInspectors.add(ev.action.id);
    fileOutputDrafts.delete(ev.action.id);

    if (!activeFileOutputConfigurations.has(ev.action.id)) {
      const settings = await ev.action.getSettings<CounterSettings>();
      activeFileOutputConfigurations.set(
        ev.action.id,
        getFileOutputConfiguration(settings),
      );
    }
  }

  override onSendToPlugin(
    ev: SendToPluginEvent<FileOutputDraftMessage, CounterSettings>,
  ): void {
    if (
      ev.payload?.event !== "fileOutputDraftChanged" ||
      typeof ev.payload.writeToFileEnabled !== "boolean" ||
      typeof ev.payload.filePath !== "string"
    ) {
      return;
    }

    fileOutputDrafts.set(ev.action.id, {
      enabled: ev.payload.writeToFileEnabled,
      path: ev.payload.filePath.trim(),
    });
  }

  override async onPropertyInspectorDidDisappear(
    ev: PropertyInspectorDidDisappearEvent<CounterSettings>,
  ): Promise<void> {
    const actionId = ev.action.id;

    try {
      if (!counterActionIds.has(actionId)) return;

      const settings = await ev.action.getSettings<CounterSettings>();
      const configuration =
        fileOutputDrafts.get(actionId) ?? getFileOutputDraftConfiguration(settings);

      // The explicit draft message is sent immediately for each field change,
      // while the component's automatic settings update may still be queued as
      // the inspector closes. Persist the final draft before activating it.
      settings.writeToFileEnabled = configuration.enabled;
      settings.filePath = configuration.path;
      await ev.action.setSettings(settings);

      const count = toInt(settings.count, toInt(settings.initialValue, 0));
      await activateFileOutputConfiguration(ev.action, configuration, count);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      streamDeck.logger.error(
        `Unable to apply counter file output after closing the Property Inspector for action=${actionId}: ${message}`,
      );
    } finally {
      fileOutputDrafts.delete(actionId);
      openPropertyInspectors.delete(actionId);
    }
  }
}

@action({ UUID: "com.github.eliankars.multiple-counters.reset" })
export class ResetCounters extends SingletonAction<resetSettings> {
  override onWillAppear(ev: WillAppearEvent<resetSettings>): void | Promise<void> {
    const settings = ev.payload.settings ?? {};
    const idleTitle = settings.idleTitle ?? "";
    setActionImage(ev.action, settings.backgroundColor);
    ev.action.setTitle(idleTitle);
    logActionDetails(ev, settings, "ResetCounters.onWillAppear");
  }

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

  override async onKeyDown(ev: KeyDownEvent<resetSettings>): Promise<void> {
    const settings = ev.payload.settings ?? {};
    const ctx = ev.action.id;
    const confirmReset = settings.confirmReset ?? false;
    const confirmResetWaitTime = toPositiveInt(settings.confirmTimeout) ?? 5000;

    if (confirmReset) {
      const existing = confirmedByContext.get(ctx);

      if (!existing) {
        await ev.action.setTitle(settings.confirmTitle);
        await setActionImage(ev.action, settings.confirmBackgroundColor);

        const timeout = setTimeout(() => {
          confirmedByContext.delete(ctx);
          ev.action.setTitle(settings.idleTitle);
          setActionImage(ev.action, settings.backgroundColor);
        }, confirmResetWaitTime);

        confirmedByContext.set(ctx, timeout);
        streamDeck.logger.trace(
          `Reset confirm started: ctx=${ctx}, group=${settings.resetGroupId ?? ""}, timeout=${confirmResetWaitTime}`,
        );
        return;
      }

      clearTimeout(existing);
      confirmedByContext.delete(ctx);
      await ev.action.setTitle(settings.idleTitle);
      await setActionImage(ev.action, settings.backgroundColor);
      streamDeck.logger.trace(
        `Reset confirmed: ctx=${ctx}, group=${settings.resetGroupId ?? ""}`,
      );
    }

    const resetGroupId = (settings.resetGroupId ?? "").trim();
    if (resetGroupId !== "") {
      await resetGroupById(resetGroupId);
    }

    logActionDetails(ev, settings, "ResetCounters.onKeyDown");
  }

  override async onDidReceiveSettings(
    ev: DidReceiveSettingsEvent<resetSettings>,
  ): Promise<void> {
    const settings = ev.payload.settings ?? {};
    const idleTitle = settings.idleTitle ?? "";

    await setActionImage(ev.action, settings.backgroundColor);
    await ev.action.setTitle(idleTitle);
    logActionDetails(ev, settings, "ResetCounters.onDidReceiveSettings");
  }
}

/** Resets all counters with the specified group ID to their own initial value. */
async function resetGroupById(groupId: string): Promise<void> {
  const resetPromises = Array.from(counterActionIds).map(async (otherId) => {
    const action = streamDeck.actions.getActionById(otherId);

    if (!action || !action.isKey()) {
      counterActionIds.delete(otherId);
      pressStates.delete(otherId);
      return;
    }

    const settings = await action.getSettings<CounterSettings>();
    if ((settings.resetGroupId ?? "").trim() === groupId) {
      const resetValue = toInt(settings.initialValue, 0);
      await setCounterValue(action, settings, resetValue);
    }
  });

  await Promise.all(resetPromises);
}

/** Settings for the Counter action. */
type CounterSettings = {
  prefixTitle?: string;
  count?: number | string;
  initialValue?: number | string;
  shortPressChangeEnabled?: boolean;
  shortPressChangeBy?: number | string;
  incdecrementBy?: number | string; // Legacy setting used before Short press — change by.
  uniqueActionId?: string;
  syncGroupId?: string;
  resetGroupId?: string;
  displayOnly?: boolean; // Legacy inverse of shortPressChangeEnabled.
  backgroundColor?: string;
  holdChangeEnabled?: boolean;
  holdChangeBy?: number | string;
  holdChangeDuration?: number | string;
  // Compatibility with the setting names used by a pre-release build.
  holdToDecrementEnabled?: boolean;
  holdToDecrementBy?: number | string;
  holdToDecrementDuration?: number | string;
  longPressKeyResetEnabled?: boolean;
  longPressKeyReset?: number | string;
  longPressGroupResetEnabled?: boolean;
  longPressGroupReset?: number | string;
  writeToFileEnabled?: boolean;
  filePath?: string;
  filePathDraft?: string;
};

/** Settings for the ResetCounters action. */
type resetSettings = {
  idleTitle?: string;
  resetGroupId?: string;
  backgroundColor?: string;
  confirmReset?: boolean;
  confirmTitle?: string;
  confirmTimeout?: number | string;
  confirmBackgroundColor?: string;
};
