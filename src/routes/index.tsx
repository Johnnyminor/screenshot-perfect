import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lex Nyhedsmonitor" },
      { name: "description", content: "Nyhedsovervågning for Lex.dk's redaktion: medtech og pharma." },
      { property: "og:title", content: "Lex Nyhedsmonitor" },
      { property: "og:description", content: "Nyhedsovervågning for Lex.dk's redaktion: medtech og pharma." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/overblik" });
  },
});
