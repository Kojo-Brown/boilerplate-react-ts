# Web Workers with Comlink

Parsing a 200,000-row CSV takes about 150ms of straight-line JavaScript on a
fast laptop. Run it on the main thread and that is one frame 133ms long: no
scroll, no hover, no button that can be pressed, and no spinner — the spinner
cannot animate either. Run the identical code in a worker and the recording
shows 33 frames at 60fps with a worst frame of 16.8ms. Those are the numbers
`e2e/worker-parsing.spec.ts` attaches to every run, from `/labs/workers`.

The parse does not get faster. That is the whole claim: it stops being the
reason the page has frozen.

| Arm         | Frames sampled | Longest frame | Effective FPS |
| ----------- | -------------- | ------------- | ------------- |
| Worker      | 33             | 16.8ms        | 60.0          |
| Main thread | 2              | 133.4ms       | 13.3          |

## The shape

```
shared/lib/csvParser.ts        the work: a resumable, synchronous parser
shared/lib/csvParserApi.ts     what the worker exposes over Comlink
shared/lib/csvParserClient.ts  the main-thread half: lifetime, cancel, cleanup
shared/hooks/useCsvParser.ts   the React binding
shared/workers/csvParser.worker.ts        the entry point — one line
shared/workers/createCsvParserWorker.ts   the `new Worker(…)` call
pages/worker-lab/             both arms, side by side
```

Comlink is the reason this reads as five ordinary modules instead of a
`postMessage` switch statement. It turns an endpoint into an object whose
methods return promises:

```ts
const remote = Comlink.wrap<CsvParserApi>(worker);
const outcome = await remote.parse({ jobId, text });
```

What it does not do is make the boundary disappear. Everything below is a place
where the boundary is still there and the code that ignores it fails silently.

## Six things that are not obvious

### 1. A microtask yield makes cancellation impossible

A parse that never yields cannot be cancelled: the worker is one thread, and a
`cancel` message sits in the port's queue until the current task ends. So the
parser runs in chunks and yields between them. The yield has to be a **task**:

```ts
await new Promise<void>((resolve) => setTimeout(resolve, 0)); // works
await Promise.resolve(); // does nothing
```

Microtasks drain _before_ the event loop takes its next task, so a thousand of
them go by with the message still queued. `csvParserApi.test.ts` runs the loop
both ways against a cancel sent immediately: the microtask arm parses all 5,000
rows having never seen it, the task arm stops after one chunk. Nothing about the
microtask version looks wrong — correct result, correct total, and a Cancel
button that does nothing at all.

Two spellings that look better and are worse:

- `scheduler.yield()` resumes the continuation at a priority _above_ newly
  queued tasks, which is backwards when the message you are yielding to hear is
  "stop".
- A `MessageChannel` ping dodges the nesting clamp below, but puts the wake-up
  in the same task source as Comlink's own traffic, competing with the message
  it exists to let through.

`setTimeout(…, 0)` costs the HTML spec's clamp: from the fifth nested timer on,
~4ms per yield. That is why the chunk is thousands of rows and not tens —
chunking at 50 rows makes the worker arm measurably _slower_ than the blocking
one.

### 2. An `AbortSignal` cannot cross the boundary

It is not structured-cloneable, so it cannot be an argument; and
`Comlink.proxy`ing one gives the worker a _remote_ signal whose `aborted` getter
is an async round trip — unreadable from inside a loop. Cancellation is
therefore a job id plus a separate `cancel(jobId)` call, and the client is what
turns the ordinary main-thread idiom back into that:

```ts
options.signal?.addEventListener("abort", () => void api.cancel(jobId), { once: true });
```

The clone failure is asserted in `e2e/worker-parsing.spec.ts`, not in a unit
test, and that is deliberate: **jsdom does not reproduce it.** Under Node's
`structuredClone` a jsdom `AbortSignal` clones happily into a plain object, so a
unit test asserting the throw would have asserted the opposite of the truth.

A cancelled parse resolves with `{ status: "cancelled" }` rather than rejecting.
It is an outcome the caller asked for, not a failure, and making it an
exception pushes an `if` into every call site.

### 3. A callback has to be proxied, and TypeScript will not tell you

```ts
await remote.parse(job, onProgress); // DataCloneError at runtime
await remote.parse(job, Comlink.proxy(onProgress)); // works
```

The first line **type-checks**. `Comlink.Remote<T>` describes a remote method's
parameters with the local types, so a bare function is a perfectly good
`ProgressSink` as far as `tsc` is concerned. An `@ts-expect-error` on that line
fails the build with "unused directive" — which is how this was found.

### 4. The side that must release the proxy is not the side that made it

`Comlink.proxy(fn)` is serialised by standing up a `MessageChannel` and shipping
one end. Neither end is ever closed unless the **receiver** asks:

```ts
// inside the worker, in a finally
(onProgress as Releasable)[Comlink.releaseProxy]();
```

Without it, a page that parses twelve files with a progress bar leaks twelve
channels and every closure each one holds — no error, nothing in the network
panel, nothing pointing at the cause. `csvParserApi.test.ts` counts
`MessagePort.close()` calls across three parses, because that is the only
observable the platform offers here.

### 5. A transfer moves the buffer; the sender is left with nothing

The result carries every amount as an `Int32Array` — an `Int32Array` rather than
`number[]` precisely so there is a buffer to move:

```ts
return Comlink.transfer(outcome, [result.amountsMinor.buffer]);
```

At 200k rows the copy this avoids is another 800KB allocated on each side, after
a parse whose entire purpose was to keep work off the receiving thread. The cost
is that `result.amountsMinor` is length 0 on the sending side the moment the
message is posted. Harmless here — the parser is dead — and a real hazard
anywhere it is not.

### 6. An error's class does not survive; its name does

Comlink reconstructs a thrown error as a plain `Error` carrying the original
name, message and stack. `instanceof CsvHeaderError` is false on the receiving
side no matter what the worker threw, so code branching on it takes the wrong
arm, silently. The client re-wraps into `CsvParseError` with the original hung
off `cause`, which is a type a caller can actually catch.

## Testing a worker without a worker

jsdom implements no `Worker`. The two options are to mock Comlink or to run the
real protocol over a `MessageChannel`, and mocking Comlink proves nothing: every
failure above is a property of the real protocol — the clone, the proxy, the
release, the task queue — and a mock has none of them.

So `src/test/workerChannel.ts` builds a `FakeWorker` from a `MessageChannel`,
and the client takes a _factory_ rather than a `Worker` so it can be handed one.
The same seam is what lets `<WorkerLabPage>` be unit-tested; it is the pattern
`docs/dependency-inversion.md` describes, applied to a thread instead of an HTTP
client.

What a channel cannot supply is the second thread — which is the one property a
unit test was never going to check, and is what `e2e/worker-parsing.spec.ts` is
for: a real `Worker` is constructed, a click is handled while a 200,000-row
parse is in flight, and the two arms' frame recordings are attached to the run.

## Starting the worker

```ts
const worker = new Worker(new URL("./csvParser.worker.ts", import.meta.url), {
  type: "module",
  name: "csv-parser",
});
```

Three details, each of which fails only in production if you get it wrong:

- **`new URL(…, import.meta.url)` must be written out literally at the call
  site.** Vite matches this exact syntactic form at build time; it does not
  evaluate the expression. Checked against the failure it names: hoisting the
  URL into a `const` one line above the `new Worker` call makes `vite build`
  emit **no worker chunk at all** — `dist/assets/csvParser.worker-*.js` simply
  is not there, the build exits 0, and the `new Worker` left in the bundle
  points at a source path that does not exist in `dist/`. It works under
  `pnpm dev`, which serves source files, so the first sign of it is a 404 in
  production.
- **`type: "module"`** is what allows the worker to use `import`. Without it the
  browser loads a classic script and fails on the first import — and Vite's dev
  server serves ES modules either way, so again this is build-only.
- **`name`** is what DevTools' thread picker shows.

## When not to do this

- **Small inputs.** A worker costs a fetch, a parse and a compile to start, plus
  a message hop each way. Below a few tens of milliseconds of work the round
  trip is the bigger number.
- **Anything touching the DOM.** A worker has no document. This pattern fits
  parsing, diffing, compression, crypto, image and geometry maths — work that
  takes bytes and returns bytes.
- **Work that returns as much as it consumes.** If the result is a large object
  graph rather than a typed array, structured cloning it can cost more than the
  computation did. That is why `CsvParseResult` is a summary plus one
  transferable buffer, and not the parsed rows.
- **When `useTransition` is enough.** If the expensive thing is _rendering_
  rather than computing, React's own scheduler already interrupts it — see
  `/labs/concurrency` and the numbers in `docs/react-compiler.md`. A worker
  cannot help with rendering at all.
