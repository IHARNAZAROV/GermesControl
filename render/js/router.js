let currentRoute = 'dashboard';
const handlers = new Set();

export function onRouteChange(fn) {
    handlers.add(fn);
    return () => handlers.delete(fn);
}

export function navigate(route) {
    currentRoute = route;
    window.location.hash = route;
    for (const fn of handlers) fn(route);
}

export function getCurrentRoute() {
    return currentRoute;
}

export function initRouter() {
    const fromHash = window.location.hash.replace('#', '');
    if (fromHash) currentRoute = fromHash;
    window.addEventListener('hashchange', () => {
        currentRoute = window.location.hash.replace('#', '') || 'dashboard';
        for (const fn of handlers) fn(currentRoute);
    });
    return currentRoute;
}
