import React from "react";

type AppStateListener = (state: "active" | "background" | "inactive") => void;

const appStateListeners = new Set<AppStateListener>();

export const AppState = {
  addEventListener(_event: "change", listener: AppStateListener) {
    appStateListeners.add(listener);
    return {
      remove() {
        appStateListeners.delete(listener);
      },
    };
  },
  currentState: "active",
};

export const AppStateMock = {
  emit(state: "active" | "background" | "inactive") {
    AppState.currentState = state;
    for (const listener of appStateListeners) {
      listener(state);
    }
  },
  reset() {
    AppState.currentState = "active";
    appStateListeners.clear();
  },
};

export const StyleSheet = {
  create<T extends Record<string, unknown>>(styles: T): T {
    return styles;
  },
  flatten(style: unknown): Record<string, unknown> {
    if (!style) {
      return {};
    }

    if (Array.isArray(style)) {
      return Object.assign(
        {},
        ...style.map((item) => StyleSheet.flatten(item))
      );
    }

    if (typeof style === "object") {
      return style as Record<string, unknown>;
    }

    return {};
  },
};

export const Text = ({
  children,
  ...props
}: React.PropsWithChildren<Record<string, unknown>>) =>
  React.createElement("Text", props, children);

export const View = ({
  children,
  ...props
}: React.PropsWithChildren<Record<string, unknown>>) =>
  React.createElement("View", props, children);

export const Pressable = ({
  children,
  ...props
}: React.PropsWithChildren<Record<string, unknown>>) =>
  React.createElement("Pressable", props, children);

export const Modal = ({
  children,
  visible = true,
  ...props
}: React.PropsWithChildren<Record<string, unknown> & { visible?: boolean }>) =>
  visible ? React.createElement("Modal", props, children) : null;
