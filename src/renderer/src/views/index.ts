/**
 * Feature views, re-exported through one module.
 *
 * App.tsx imports only from here, so adding a page never means editing the
 * router. Each file below is owned by exactly one feature.
 */
export { default as Explore } from './Explore'
export { default as Downloaded } from './Downloaded'
export { default as Settings } from './Settings'
export { default as Album } from './Album'
