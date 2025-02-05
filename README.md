# Multiple Counters for Stream Deck
<img src="multiple-counters-icon.png" align="right" height="150" width="150" alt="'Multiple Counters' Plugin icon">

A Stream Deck plugin that lets you group multiple counters and reset them all with a single button press. Perfect for stream sessions, production tracking, quality control counts, or any situation where you need to monitor and reset multiple counts together.
<br/>
<br/>

## ✨Features
<img src="preview1.jpg" align="right" height="150" width="300" alt="Photo of the buttons in action">

- Create multiple counter action buttons
- Assign the ID of a reset action button
- Reset multiple counters with one push
- Increment/decrement counters individually
- Customize counter background color
- Customize reset background color
- Reset button ask's for confirmation
- Choose from a list of basic background colors, each color also has an adjusted version '_(c)_' to provide better contrast with white text according to WCAG contrast requirements (minimum 4.5:1 ratio).


## 🚀Installation
1. Download _Multiple Counters_ plugin in the Stream Deck Store or [here](https://github.com/ElianKars/StreamDeck-Multiple-Counters/releases/tag/Latest).
2. Double-click the downloaded file to install
3. Stream Deck will automatically add the plugin


## 🔧 Usage
<img src="preview2.jpg" height="400" width="800" alt="Photo of the buttons in action">

### Counter Action
1. Drag the Counter action to your Stream Deck
2. Configure settings:
   - **Prefix Title:** Set your counter label
   - **Increment By:** Choose value between `1-10`
   - **Shared ID:** Set an ID to group counters for reset. Must match with reset action. Example: `group1`
   - **Background Color:** Choose a color

> [!IMPORTANT]  
> Use the `Prefix Title` field, not the built-in `Title` field. You can use the Title field only for text formatting.


### Reset Action
1. Drag the Counter action to your Stream Deck
2. Configure settings:
   - **Initial title:** Set the initial title for the reset action
   - **Target Shared ID:** Match with counters you want to reset. Example: `group1`
   - **Background Color:** Choose normal state color
   - **Confirm Reset:** Enable/disable double-press confirmation
   - **Confirm title:** Set the title shown during the confirmation wait
   - **Wait Time:** Set confirmation timeout `1-60 seconds`
   - **Confirmation Color:** Choose color for confirmation state

> [!IMPORTANT]  
> Use the `Prefix Title` field, not the built-in `Title` field. You can use the Title field only for text formatting.


## 📝Changelog
### 1.0.1
- Minor textual adjustments
### 1.0.0
- Initial release


## 🐛Support
Found a bug? Have a feature request? [Open an issue](../../issues)


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