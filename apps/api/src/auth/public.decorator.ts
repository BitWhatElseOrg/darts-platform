import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_ENDPOINT = Symbol("IS_PUBLIC_ENDPOINT");

export const Public = () => SetMetadata(IS_PUBLIC_ENDPOINT, true);
