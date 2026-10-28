
import { Injectable, inject, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';

import {
  RemoteDevice,
  RemoteDevicesService
} from './remote-devices.service';

export interface PairedDevice {
  id: string;
  name: string;
  pairedAt: number;
  lastSeen: number;
  online: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class ConnectionDialogService {

  private readonly devices = inject(RemoteDevicesService);

  readonly toForget = signal<RemoteDevice | null>(null);
  readonly toRevoke = signal<PairedDevice | null>(null);

  readonly paired = signal<PairedDevice[]>([]);
  readonly error = signal('');

  requestForget(device: RemoteDevice): void {
    this.toForget.set(device);
  }

  requestRevoke(device: PairedDevice): void {
    this.toRevoke.set(device);
  }

  cancelForget(): void {
    this.toForget.set(null);
  }

  cancelRevoke(): void {
    this.toRevoke.set(null);
  }

  async confirmForget(): Promise<void> {
    const device = this.toForget();

    if (!device) return;

    this.toForget.set(null);
    this.devices.forget(device.hostId);
  }

  async loadPaired(): Promise<void> {
    try {
      this.paired.set(
        await invoke<PairedDevice[]>('list_paired_devices')
      );
    } catch {
      // El backend puede no estar disponible.
    }
  }

  async confirmRevoke(): Promise<void> {
    const device = this.toRevoke();

    if (!device) return;

    this.toRevoke.set(null);
    this.error.set('');

    try {
      await invoke('revoke_paired_device', { id: device.id });
      await this.loadPaired();
    } catch (error) {
      this.error.set(String(error));
    }
  }
}
