# Live regions

**Source:** `src/shared/a11y/`
**Demo:** `/labs/live-regions` — the regions' contents, on screen
**Tests:** `src/shared/a11y/*.test.ts(x)`, `e2e/live-regions.spec.ts`

A live region is how a page says something to a screen reader that the user did
not ask for: a save succeeded, a filter left nothing, a request failed. Getting
one to speak at all is four or five details that each fail silently, so this is
one system rather than a `role="status"` per component.

```
announce("12 results")            ─┐
toast({ title: "Saved" })         ─┤→  announcer (store, queued)  →  <LiveRegions/>
useAsyncStatusAnnouncement(...)   ─┤                                  4 sr-only spans
useDebouncedAnnouncement(...)     ─┘                                  in app/main.tsx
```

## The rules that shape it

Everything below follows from four facts about live regions, none of which
produce an error when you get them wrong.

**A region is announced when its contents change while it is already in the
document.** A region that _appears_ with its text in it is a new node rather
than a mutation and commonly goes unannounced. So the four regions are mounted
in `src/app/main.tsx` — above the router, outside every provider, empty from the
first paint, never remounted. `e2e/live-regions.spec.ts` asserts that, because
it is a property of where the component is mounted and no unit test can see it.

**Two changes in one tick are one mutation.** The first text never exists at a
moment anything could observe it: it is not announced late, it is never
announced, and the region ends up holding the second message — which is exactly
what one correct announcement looks like. So messages queue, one written per
150ms. `polite` and `assertive` are separate queues, because an error made to
wait behind three status messages has been demoted to polite by plumbing.

**Setting the same text twice is not a change.** React declines to touch an
unchanged text node, so "No results" after "No results" is silent — and "the
filter still matches nothing" is precisely a thing a user asks twice. Each
politeness therefore has _two_ regions and writes alternately into them, so
every announcement is an empty region gaining content.

**A region that is removed takes its queued speech with it.** This is why a
toast does not announce itself: the card is gone after four seconds, which is
less than a screen reader often needs to reach a message.

The four regions carry `aria-live` and `aria-atomic` rather than `role="status"`
and `role="alert"`. Those roles are _defined_ as exactly those attribute pairs,
so nothing changes for a reader — but they are also a claim to be a status
message or an alert, made permanently by four spans that are empty almost all of
the time. Anything that asks the document for its alerts would find them:
`page.getByRole("alert")` on the login page would match the form's error and two
empty spans, and a user listing the page's elements gets four entries that are
never anything. `aria-atomic` is the half that matters — without it a reader may
announce only the parts of the subtree that changed, which for "12 results"
following "2 results" is the word "12" on its own.

## Events, not state

The announcer is for things that _happen_. A region that reflects a condition —
the offline banner, the route progress bar — stays its own region and is
deliberately not migrated, because state has to be able to go quiet again and a
queue cannot un-say a sentence. "Loading /about" must stop being true when the
navigation lands; "12 results" was true when it was said and stays said.

The same line decides the other direction. When something is on screen _and_
worth announcing, only one of the two speaks: `PostFeed` announces its row count
through the announcer and leaves its error to the visible `role="alert"`
paragraph, because two regions describing one failure is the user hearing it
twice. `Combobox` is the same split from the other side — the count goes to the
announcer as news, and the "No matches for “york”" paragraph stays
`aria-describedby` as state, re-readable by someone who arrives at the field
after the announcement has passed.

## The four entry points

| API                                                | For                                                    | Politeness                   |
| -------------------------------------------------- | ------------------------------------------------------ | ---------------------------- |
| `announce(message, options?)`                      | anything, including non-React code                     | polite unless asked          |
| `useAnnounce()`                                    | a component — retracts what it queued when it unmounts | polite unless asked          |
| `useAsyncStatusAnnouncement({ status, messages })` | a query, action or machine                             | error assertive, rest polite |
| `useDebouncedAnnouncement(message)`                | a count that changes as the user types                 | polite                       |

`useAnnounce` is the default choice in a component. The binding it adds is the
reason: a panel that said "Loading posts" and then navigated away is describing a
load nobody is waiting for, and a queue that kept it would speak it into the next
page. Nothing can retract a message already written to a region.

### Async status

```tsx
const { data, status } = useQuery({ queryKey, queryFn });

useAsyncStatusAnnouncement({
  status,
  messages: {
    pending: "Loading posts",
    success: data === undefined ? null : `${data.length} posts loaded`,
    error: "Posts could not be loaded",
  },
});
```

Three decisions worth knowing before using it:

- **The status it mounts with is never announced.** A panel arriving with cached
  data has nothing to report, and on a route change the route announcer has just
  said where the user is. It also makes the common case right for free: a list
  that mounts `pending` and resolves says one thing, its result.
- **`status`, not `isFetching`.** TanStack Query holds `status` at `"success"`
  through a background refetch, so every window-focus refetch and poll is silent
  without any code for it. A refetch that _fails_ while showing stale data does
  move to `"error"` and is announced, which is right: the data on screen is no
  longer being kept up to date.
- **A pending message waits half a second.** Under that, the result lands first
  and the announcement's only effect is "Loading posts, 12 posts loaded" for
  something that took 80ms. A load that finishes inside the delay was never
  announced, rather than announced and superseded.

"Loaded" is not a message. What the user needs is what changed — `12 posts`,
`no matching invoices` — because the completion of a fetch is only interesting as
the reason they are being told something.

## Politeness

`assertive` stops the reader mid-word. It costs the user the sentence they were
listening to, so it has to be worth more than that sentence:

- **Assertive**: something failed, or something is about to expire.
- **Polite**: everything else, including every success.

Toasts derive it from the variant — `danger` and `warning` interrupt, `success`
and `default` do not — because on that component the variant is already a claim
about urgency. `toast({ politeness })` overrides it for the toast whose urgency
is not its colour.

Announcing a success assertively is the most common mistake in this area: every
save cutting off whatever the user was reading, to tell them the thing they
asked for happened.

## Limits

- **Bursts are capped.** Eight unspoken messages per queue; beyond that the
  oldest are dropped, because speech cannot be skipped and the newest message is
  the truest description of where things stand. A loop that announces per row
  will lose the middle of it.
- **`reset()` cannot un-say anything.** It clears the queues and the regions;
  whatever the reader has started, it finishes.
- **Nothing drains before something is listening.** Effects run child-first, so a
  component announcing from its own mount effect gets there before
  `<LiveRegions>` has subscribed. The queue holds until the first subscriber
  arrives — which also makes `announce()` in a unit test that renders no regions
  a bounded, silent no-op.
- **`RouteAnnouncer` is not built on this**, and stays as it is. It owns its own
  pair of regions because its announcement and its focus move have to agree on
  when a navigation happened; see `docs/focus-management.md`.
- **The error paragraphs are still `role="alert"`.** A dozen components announce
  a failure by rendering a `role="alert"` that appears with its text already in
  it. That is the well-supported case for `alert` specifically — inserting an
  alert element is announced where inserting a `status` one is not — but it is
  still the shape this system exists to avoid, and nothing verifies it. They are
  deliberately left alone here: moving one means deciding what stays on screen
  for a sighted user, which is a change per component rather than a change to
  this. `PostFeed` shows the interim rule, which is that only one of the two
  speaks: the count goes through the announcer, the failure stays with the
  paragraph.
- **A toast still auto-dismisses after four seconds.** The announcement now
  outlives it, but the _card_ is gone, so a user who wants to re-read a message
  has to reach the Notifications landmark before it disappears.
