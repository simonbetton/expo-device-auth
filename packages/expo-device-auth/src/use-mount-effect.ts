import { useEffect, useEffectEvent } from "react";
import type { EffectCallback } from "react";

export const useMountEffect = (effect: EffectCallback): void => {
  const onMount = useEffectEvent(effect);
  useEffect(() => onMount(), []);
};
