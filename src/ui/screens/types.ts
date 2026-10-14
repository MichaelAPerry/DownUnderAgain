import type { AppApi } from '../../app/api';

/** A screen builds its DOM from the app API; the app mounts it into #ui. */
export type ScreenView = (app: AppApi) => HTMLElement;
