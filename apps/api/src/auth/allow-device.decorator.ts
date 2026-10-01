import { SetMetadata } from "@nestjs/common";

export const ALLOW_DEVICE_ENDPOINT = Symbol("ALLOW_DEVICE_ENDPOINT");

/** Gibt einen Handler fuer Scheiben-Tablets frei. Ohne diese Markierung lehnt der Guard jedes Geraet ab. */
export const AllowDevice = () => SetMetadata(ALLOW_DEVICE_ENDPOINT, true);
