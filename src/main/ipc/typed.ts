import { BrowserWindow, ipcMain } from 'electron'
import type {
  IpcChannel,
  IpcEventChannel,
  IpcEventPayload,
  IpcRequest,
  IpcResponse
} from '@shared/ipc'

/** Register a typed invoke handler for a channel from the shared IPC contract. */
export function handle<C extends IpcChannel>(
  channel: C,
  handler: (request: IpcRequest<C>) => IpcResponse<C> | Promise<IpcResponse<C>>
): void {
  ipcMain.handle(channel, (_event, request) => handler(request as IpcRequest<C>))
}

/** Send a typed push event (e.g. analysis progress) to all renderer windows. */
export function broadcast<C extends IpcEventChannel>(
  channel: C,
  payload: IpcEventPayload<C>
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

/** Marker error for handlers a later phase will implement. */
export function notImplemented(channel: IpcChannel): never {
  throw new Error(`[ipc] '${channel}' is not implemented yet`)
}
