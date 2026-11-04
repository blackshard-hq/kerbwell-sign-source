// Black Shard stub: CSC signing cookies are inert on this deployment.
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { z } from 'zod';

export const ZCscBlockingErrorPayloadSchema = z.any();

export type TCscBlockingErrorPayload = z.infer<typeof ZCscBlockingErrorPayloadSchema>;

export const setCscBlockingErrorCookie = async (..._args: any[]): Promise<void> => undefined;

export const getCscBlockingErrorCookie = async (..._args: any[]): Promise<any> => null;

export const clearCscBlockingErrorCookie = async (..._args: any[]): Promise<void> => undefined;

export const buildClearCscBlockingErrorCookieHeader = (..._args: any[]): string =>
  'csc_blocking_error=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax';

export const readCscBlockingErrorFromRequest = async (..._args: any[]): Promise<any> => null;
