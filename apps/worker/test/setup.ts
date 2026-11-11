import { afterAll, afterEach, beforeAll } from "vitest";
import { network } from "./lastfm.ts";

beforeAll(() => network.enable());
afterEach(() => network.resetHandlers());
afterAll(() => network.disable());
