import type { Request, Response } from "express";
import { app, prepareApp } from "../server/index.js";

const queryValue = (value: unknown) =>
  Array.isArray(value) ? value.map(String) : typeof value === "string" ? [value] : [];

export default async function handler(request: Request, response: Response) {
  const routeParts = queryValue(request.query.path);
  const pathname = `/api/${routeParts.join("/")}`.replace(/\/+$/, "");
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(request.query)) {
    if (key === "path") continue;
    for (const item of queryValue(value)) search.append(key, item);
  }
  request.url = `${pathname}${search.size ? `?${search}` : ""}`;

  const databaseIndependentRequest =
    pathname === "/api/content" ||
    pathname === "/api/stripe/config" ||
    pathname === "/api/reverse-geocode" ||
    pathname === "/api/location-search" ||
    pathname === "/api/fare/calculate" ||
    pathname === "/api/fare-estimate";
  if (!databaseIndependentRequest) await prepareApp();
  return app(request, response);
}