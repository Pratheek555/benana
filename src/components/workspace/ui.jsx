import React from "react";
export const Badge = ({ children, tone = "" }) => (
  <span className={`badge ${tone}`}>{children}</span>
);
