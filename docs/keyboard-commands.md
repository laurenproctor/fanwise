# Keyboard commands

Two systems, one registry. The command palette (⌘K on a Mac, Ctrl K elsewhere) is the
searchable list of everything the keyboard can do; the `F` layer is the fast path between
the workspace's sections. Both read the same rows, so a shortcut that is not registered
cannot be pressed, listed, or labelled.

## The registry

`lib/commands/` is the whole rulebook and none of it touches React or the DOM, so every rule
is a unit test in `tests/unit/commands-*.test.ts`:

| Module | Decides |
|---|---|
| `types.ts` | The `FanwiseCommand` shape: id, label, group, keywords, shortcuts, scope, enabled, disabled reason, execute |
| `shortcuts.ts` | Whether a keystroke matches a shortcut on this platform, and how a shortcut is printed (`⌘K`, `Ctrl Shift Enter`, `Meta+K` for `aria-keyshortcuts`) |
| `input-safety.ts` | When a key is typing rather than a command: fields, the rich-text editor, comboboxes, open menus, foreign dialogs, IME composition, and the `data-shortcuts="off"` opt-out |
| `sequence.ts` | The `F` layer's timing: opens on F, one letter navigates, anything else closes, 1.5 s timeout |
| `registry.ts` | Live commands by id, scope priority when two answer one key, and collision detection |
| `search.ts` | The palette's ranking and grouping |
| `preferences.ts` | The three things the browser remembers, in local storage: single keys off, the hint retired, recent product slugs |
| `navigation.ts` | The `F` destinations and the section routes, from `lib/routes` |
| `workspace.ts` | Every command id and shortcut constant, in one place |

`components/commands/command-provider.tsx` is the one keydown listener in the application.
It is mounted by `app/[slug]/layout.tsx`, which a client-side navigation never remounts.
Pages and components register through `useRegisterCommands()` and unregister on unmount,
which is how "only on the product editor" is enforced without anything knowing the route.
A registration is keyed on everything but `execute`, so a re-render does not re-register
and a keystroke runs the latest closure exactly once.

Scopes, narrowest first: `selection` (only while focus is inside the element named by
`within`, marked `data-command-scope`), `page` (while the registering component is mounted),
`navigation` and `global` (everywhere). The narrower scope wins a shared key.

## Shortcuts

Everywhere in a workspace:

| Action | Keys |
|---|---|
| Open the command palette | ⌘K / Ctrl K |
| Keyboard shortcuts reference | ? |
| Create a product | C |
| Import a product | I |
| Focus the catalog's search box | / (navigates to the catalog first if needed) |
| Close the palette, guide or reference | Escape |
| Fanwise navigation | F, then P Products · C Channels · R Profile · S Settings · V Preview public profile |

On a product's page (the editor):

| Action | Keys | Backed by |
|---|---|---|
| Save draft | ⌘S / Ctrl S | The form's own `save()`; the font workspace's `autosave.flush()` |
| Publish everywhere | ⌘Shift Enter / Ctrl Shift Enter | `publishEverywhereAction`, with the button's own blocked reason |
| Preview | P | The product's public page in a new tab; a font's storefront preview dialog |
| Add images | M | The image panel's file picker |
| Compose with AI | A | On a channel listing page, the compose panel's button |

In the product list, while a row's link has focus:

| Action | Keys |
|---|---|
| Next / previous product | J or ↓ / K or ↑ |
| Open the focused product | Enter (the link's own) |
| Edit the focused product | E (the product's page is its editor) |

There is no key for deleting anything, and there must not be one.

## Rules

- A shortcut and its button run the same function. A command is registered beside the
  control it duplicates, with the control's own enabled state and reason.
- Single keys never fire from anything editable, during composition, inside an open
  `<dialog>` that is not the palette or the reference, on a touch device with no hovering
  pointer, or on a held key. Modifier shortcuts are allowed inside fields (⌘S from a
  textarea is the point) but not during composition or inside a foreign dialog.
- `preventDefault()` is called only after a command has been recognised, so the browser's
  own ⌘L, ⌘T, ⌘W, ⌘R and ⌘P are untouched, as are undo, copy and paste.
- A recognised shortcut on a disabled command says why in the status bar at the bottom of
  the window rather than doing nothing. The palette prints the same reason under the row.
- The setting "Single-key shortcuts" in Settings › Keyboard turns printable single keys
  and the `F` layer off for this browser. ⌘K and the other modifier shortcuts stay on.
  Arrow keys and Enter inside a focused list stay on too; they are the widget's, not ours.
- Analytics: two events through the provider already in the root layout,
  `command_palette_opened` and `command_executed` with a command id and the method
  (palette, shortcut or sequence). Never a keystroke, a search string or a product name.

## Accessibility

The palette and the reference are native `<dialog>`s opened with `showModal()`, so the
rest of the page is inert and focus is trapped by the browser. Each remembers the element
that had focus and gives it back on close; when a command runs, that happens before the
command does, so a command that moves focus itself is not undone. The palette's field is
an ARIA combobox over a listbox with `aria-activedescendant`; the count of results is a
polite live region. The `F` guide is one polite `role="status"` that is always in the DOM
and fills when the guide opens, so it is announced once and never while empty. Nothing
animates, so reduced motion has nothing to reduce. Selection and disabled state are words
and an outline, never colour alone.
