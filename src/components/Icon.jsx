import React from "react";

const paths = {
  plus: (
    <>
      <path d="M12 5v14M5 12h14" />
    </>
  ),
  tasks: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="m8 12 2.5 2.5L16 9" />
    </>
  ),
  graph: (
    <>
      <circle cx="6" cy="12" r="2" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="m8 11 8-4M8 13l8 4" />
    </>
  ),
  history: (
    <>
      <path d="M4 12a8 8 0 1 0 2.3-5.7L4 8" />
      <path d="M4 4v4h4M12 8v5l3 2" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 5h16v14H4zM4 14h4l2 2h4l2-2h4" />
    </>
  ),
  spark: (
    <>
      <path d="m12 3 1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4zM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.5 1A8 8 0 0 0 14 5.8L13.6 3h-4L9.2 5.8A8 8 0 0 0 6.8 7L4.3 6l-2 3.4 2 1.6a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.5-1A8 8 0 0 0 9.2 18l.4 3h4l.4-3a8 8 0 0 0 2.4-1.2l2.5 1 2-3.4-2-1.5a7 7 0 0 0 .1-1z" />
    </>
  ),
  send: (
    <>
      <path d="m4 4 17 8-17 8 3-8zM7 12h14" />
    </>
  ),
  file: (
    <>
      <path d="M6 3h8l4 4v14H6zM14 3v5h5" />
    </>
  ),
  check: (
    <>
      <path d="m5 12 4 4L19 6" />
    </>
  ),
  chevron: (
    <>
      <path d="m9 18 6-6-6-6" />
    </>
  ),
  close: (
    <>
      <path d="m6 6 12 12M18 6 6 18" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2" />
    </>
  ),
  chat: (
    <>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </>
  ),
  x: (
    <>
      <path d="M18 6 6 18M6 6l12 12" />
    </>
  ),
  loader: (
    <>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </>
  ),
  circle: (
    <>
      <circle cx="12" cy="12" r="10" />
    </>
  ),
};

export default function Icon({ name, size = 17 }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
