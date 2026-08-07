"use client";

import { useEffect } from "react";

export default function PageBackground({ color }: { color: string }) {
  useEffect(() => {
    const prev = document.body.style.backgroundColor;
    document.body.style.backgroundColor = color;
    document.body.style.transition = "background-color 0.2s ease";
    return () => {
      document.body.style.backgroundColor = prev;
    };
  }, [color]);

  return null;
}
