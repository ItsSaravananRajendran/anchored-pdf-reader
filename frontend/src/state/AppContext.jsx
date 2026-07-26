/**
 * App-wide React context. Exposes state and dispatch via a hook.
 *
 * State is intentionally NOT exported — components must go through the
 * context. This is the "single source of truth" boundary the v3 spec
 * requires: there's no way for a component to mutate state directly.
 */

import {
    createContext,
    useContext,
    useReducer,
    useMemo,
} from "react";
import { reduce } from "./reducer";
import { initialState } from "./initialState";

const AppContext = createContext(null);

export function AppProvider({ children }) {
    const [state, dispatch] = useReducer(reduce, undefined, initialState);
    // Memoize the value so consumers don't re-render unnecessarily
    const value = useMemo(() => ({ state, dispatch }), [state]);
    return (
        <AppContext.Provider value={value}>
            {children}
        </AppContext.Provider>
    );
}

export function useApp() {
    const ctx = useContext(AppContext);
    if (!ctx) {
        throw new Error("useApp must be called inside <AppProvider>");
    }
    return ctx;
}

export function useStateSelector(selector) {
    const { state } = useApp();
    return selector(state);
}

export default AppContext;