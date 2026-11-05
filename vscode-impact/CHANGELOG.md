# Changelog

## 0.1.0

First release.

- Put the cursor on a variable, attribute, parameter or function and run **pyflow: What changes if this changes?**
- The editor marks the name you asked about and every place the change reaches. Lines are tinted and shown in the scroll bar.
- Output and side effects (`print`, `write`, `send`, logging) are marked separately.
- Places that change only through a condition (`if`, loops, guard clauses) are marked separately, and can be switched off.
- Explorer view lists the affected places by kind; click one to jump to it. Hover a mark to see the path that leads to it.
- The graph opens beside the editor as the same page as the web demo, following the cursor. It bundles the Python runtime (Pyodide), so the package is about 15 MB.
- English and Traditional Chinese.
- Analyzes the text in the editor, including unsaved changes. Runs locally; nothing is sent anywhere.
