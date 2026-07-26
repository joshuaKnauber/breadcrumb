import type { ReactNode } from "react";
import "@breadcrumb-sh/react/styles.css";

export const metadata = { title: "breadcrumb example" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
