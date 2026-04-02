# Multiple Counters for Stream Deck
<img src="multiple-counters-icon.png" align="right" height="150" width="150" alt="'Multiple Counters' Plugin icon">

A Stream Deck plugin that lets you group multiple counters and reset them all with a single press. Perfect for stream sessions, production tracking, quality control counts, or any situation where you need to monitor and reset multiple counts together.
<br/>
<br/>

## ✨Features
<img src="preview1.jpg" align="right" height="150" width="300" alt="Photo of the keys in action">

- Create multiple counter keys
- Increment/decrement counters individually or apply the same step across a sync group
- Two ways to reset: either hold the counter key or use a dedicated Reset Action key
- Reset multiple counters at once as a group
- Optional confirmation before reset
- Customize background colors
- A Counter action can run inside a standard Multi Action, including sync-group updates
- Display-only counters that act as read-only displays (for example, when updated via Multi Actions)


## 🚀Installation
1. Find the _Multiple Counters_ plugin in the Stream Deck Store or download [here](https://github.com/ElianKars/StreamDeck-Multiple-Counters/releases/tag/Latest).
2. Double-click the downloaded file to install
3. Stream Deck will automatically add the plugin


## 🔧 Usage
<img src="preview2.jpg" height="400" width="800" alt="Photo of the keys in action">

### Counter Action
1. Drag the Counter Action to your Stream Deck
2. Configure settings:
   - **`Title`**: Leave this field blank; it is only read for styling (font, size, alignment), not for the counter label.
   - **`Prefix Title`:** Set your label shown before the value.
   - **`Initial value`:** Set an initial value for the counter. Defaults to 0 if empty.
   - **`Inc/decrement by`:** Choose a whole number like 1 or -2. Defaults to 1 if empty.
   - **`Sync group ID`:** Set an ID to group counters so they all apply the same increment or decrement step when one of them is triggered. Example: `sync1`
   - **`Reset group ID`:** Set an ID to group counters for reset. Must match with 'Reset group ID' in a Reset Action. Example: `reset1`
   - **`Hold → reset key (ms)`:** Milliseconds to press and hold the key, to reset this counter to their own intial value. Useful if you prefer not to use a separate Reset Action. Disabled if left empty.
   - **`Hold → reset group (ms)`:** Milliseconds to press and hold the key, to reset all counters that share the same Reset group ID to their own intial value. Useful if you prefer not to use a separate Reset Action. Disabled if left empty.
   - **`Display-only`:** The key shows the live value but does not respond to increment or decrement presses. If a hold-to-reset duration is set, it can still be used for reset actions. The counter can still be updated through a sync group.
   - **`Background Color`:** Choose a color.

> [!IMPORTANT]  
> Enter your label in `Prefix Title`. Use the built-in `Title` box only to style the text (font, size, alignment).


### Reset Action
1. Drag the Reset Action to your Stream Deck
2. Configure settings:
   - **`Title`**: Leave this field blank; it is only read for styling (font, size, alignment), not for the counter label.
   - **`Normal-state title`:** Set the initial title for the Reset Action.
   - **`Reset group ID`:** Match with counters you want to reset. Each counter resets to its own `Initial value` (or 0 if no initial value is set). Example: `reset1`
   - **`Background Color`:** Choose normal state color.
   - **`Confirm Reset`:** Enable/disable double-press confirmation.
   - **`Confirm title`:** Set the title shown during the confirmation wait.
   - **`Second press timeout (ms)`:** Set confirmation timeout in milliseconds.
   - **`Confirmation background color`:** Choose color for confirmation state.

Each backgroundcolor also has an adjusted version '_(c)_' to provide better contrast with white text according to WCAG contrast requirements (minimum 4.5:1 ratio)

> [!IMPORTANT]  
> Enter your label in `Normal-state title`. Use the built-in `Title` box only to style the text (font, size, alignment).


### Advanced setup and usage
You may want to press a single key on your Stream Deck to perform another action (such as launching a program) and increment a counter at the same time.

**How to set it up:**  
Use a standard Stream Deck **Multi Action** to combine both steps into one workflow.
For example, a **Multi Action** can:
1. launch a program
2. increment a counter

For step 2, add a **Counter** action inside the **Multi Action** and configure it like this:
- `Inc/decrement by` = `1`
- `Sync group ID` = `sync1`

Because this counter is placed inside the **Multi Action**, it will not be visible as a separate key on your Stream Deck.

To see the current count, add another **Counter** action, directly to a key, and use the same `Sync group ID` = `sync1`.  
Enable `Display-only` if you want that visible counter to act as a read-only display.

Now, when you press the Multi Action key, your program is launched, the hidden counter is incremented, and the visible counter updates automatically.


## 🐛Support
Found a bug? [Open an issue](../../issues)
Have a feature request? [Let me know](../../discussions/categories/ideas)
I’d love to hear how you use it, even if you don’t have any questions.👂🏼 I’m very curious to know what kind of use case this plugin is useful for in your setup. [You’d really make my day by sharing it!❤️](../../discussions/4)
 

## 🛠️ Development
Built with:
- Stream Deck SDK
- Node.js v22.13.0 (LTS)
- TypeScript


## 📄License
[MIT License](LICENSE)


## 😼
> [!CAUTION]
> Beware: Cats are planning to take over the world! First, they steal our keyboards. Then, world domination.


## 📝Changelog
### beta-1.2.2
**Changed**
- **Counter setting: `Inc/decrement by`**<br/>
  The counter setting `Increment by` has been renamed to `Inc/decrement by`, because counters can now also be decreased.<br/>
  Sliders do not work well in this UI, so this setting now uses a text field instead.<br/>
  You can enter both positive and negative whole numbers (integers).<br/>
- Adjusted the placeholder text in several UI fields to make the settings clearer.

**New**
- `Initial value`: Now that counters can also count down, it is possible to define an initial value for each counter.

**Fixed**
- Fixed an issue where long-press reset actions could interfere with each other.

### beta-1.2.1
**Changed**
- **Counter settings: Instant long-press actions**<br/>
Hold-to-reset now fire while the key is still held down instead of waiting for you to release the key.

- **UI change**<br/>
While a slider seems logical to input milliseconds, it doesn’t work well in the Stream Deck UI.<br/>
Counter settings: `Hold → reset key` and `Hold → reset group` now use a textfield instead of the slider.<br/>
⚠️**BREAKING** After updating, existing profiles must re-enter this values once:<br/>
Reset settings: `Second press timeout` now use a textfield instead of the slider.<br/>

### beta-1.2.0
**New**
- **Long‑press resets for the Counter Action**<br/>
Prefer not to use a separate Reset Action? Long-press your Counter Action key instead with this new settings:<br/>
`Hold → reset key (ms)`: press and hold for the configured duration to reset only the pressed key to 0.<br/>
`Hold → reset group (ms)`: press and hold for the configured duration to reset all counters that share the Reset group ID to 0.<br/>
Default duration: 10,000 ms (10 s), so effectively disabled by default.
### 1.1.0
**New**
- **Counter synchronisation**<br/>
Counters that share the same `Sync group ID` mirror each other. Incrementing any one of them immediately updates the others.
_Typical use-case:_ embed a hidden Counter in a Multi Action to bump a visible Counter key. See the _Usage_ section for details.

- **Display-only counters**<br/>
Set 'Display-only' to prevent user input; pressing it won't do anything.
_Typical use-case:_ The Counter is incremented by a Multi Action, so this button should serve purely as a display and not accept direct input.

**Changed (possibly BREAKING)**
- **New field names**
The new functionality required some field renaming, plus two new fields.

| Old field                         | New field              | Applies to                         |
| --------------------------------- | ---------------------- | ---------------------------------- |
| `sharedId`                        | `Reset group ID`       | Increment Counter                  |
| `---`                             | `Sync group ID`        | Increment Counter / Reset Counters |
| `---`                             | `Display only`         | Increment Counter                  |
| `Target Shared ID`                | `Reset group ID`       | Reset Counters                     |
| `Initial title`                   | `Normal-state title`   | Reset Counters                     |
| `Wait for confirmation (seconds)` | `Second press timeout` | Reset Counters                     |

<ins>Upgrade note:</ins> Profiles created prior to this version may show empty values for the renamed fields; set them once to re-link.

### 1.0.1
- Minor textual adjustments
### 1.0.0
- Initial release