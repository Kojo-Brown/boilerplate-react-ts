import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "@/app/store";

/**
 * The typed `react-redux` hooks, available to every layer.
 *
 * `RootState` can only be spelled where the reducers are combined, and that is
 * the application's composition root by definition — so these types come *down*
 * from `app/`, which the import-boundary rule would normally forbid. It permits
 * this one shape of exception, and only this one: `import type`. A type import
 * is erased before the module graph exists, so nothing here can pull `app/` into
 * a bundle, create a runtime cycle, or make a lower layer stop working when the
 * store is reconfigured. What crosses the boundary is a description of the
 * store's shape, not the store.
 *
 * The alternative — restating `RootState` structurally in `shared/` — would put
 * the same coupling back with the type checker no longer able to see it, which
 * is worse in the way that matters: it fails silently.
 *
 * Inverting this properly means the root reducer no longer knowing its own
 * slices (`combineSlices` + `slice.injectInto`), which changes when `state.auth`
 * exists at runtime. That belongs to the dependency-inversion item, not here.
 */
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
