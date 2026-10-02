// Worker threads don't pick up the tsx loader from the parent; register it here, then load the TS worker.
import { register } from "tsx/esm/api";

register();
await import("./genWorker.ts");
