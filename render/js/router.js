let currentRoute = 'dashboard';
const handlers = new Set();

export function onRouteChange(fn) {
    handlers.add(fn);
    return () => handlers.delete(fn);
}

function emitRouteChange(route) {
    for (const fn of handlers) fn(route);
}

export function navigate(route) {
    const nextRoute = route || 'dashboard';
    if (nextRoute === currentRoute) return;

    if (window.location.hash.replace('#', '') !== nextRoute) {
        window.location.hash = nextRoute;
        return;
    }

    currentRoute = nextRoute;
    emitRouteChange(currentRoute);
}

export function getCurrentRoute() {
    return currentRoute;
}

export function initRouter() {
    const fromHash = window.location.hash.replace('#', '');
    if (fromHash) currentRoute = fromHash;
    window.addEventListener('hashchange', () => {
        const nextRoute = window.location.hash.replace('#', '') || 'dashboard';
        if (nextRoute === currentRoute) return;
        currentRoute = nextRoute;
        emitRouteChange(currentRoute);
    });
    return currentRoute;
}
