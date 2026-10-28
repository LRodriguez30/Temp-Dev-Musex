import {
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal
} from '@angular/core';

import { Router } from '@angular/router';

import QRCode from 'qrcode';

import { invoke } from '@tauri-apps/api/core';

import { IS_ANDROID } from '../../core/platform/invoke';

import {
  ConnectionState,
  RemoteDevice,
  RemoteDevicesService
} from '../../core/services/remote-devices.service';

import { LibraryService } from '../../core/services/library.service';
import { PlaylistSyncService } from '../../core/services/playlist-sync.service';
import {
  ConnectionDialogService,
  PairedDevice
} from '../../core/services/connection-dialog.service';

import { ConfirmDialogComponent } from '../../components/confirm-dialog/confirm-dialog.component';

// -------------------------------------------------------------
// Tipos del escritorio
// -------------------------------------------------------------

interface StreamInfo {
  url: string;
  pairingCode: string;
  expiresAt: number;
  hostId: string;
  hostName: string;
}

/**
 * Conexión entre el escritorio y el teléfono.
 *
 * Escritorio: muestra el QR de vinculación y los teléfonos vinculados.
 * Android:    panel de conexión con el equipo activo, los equipos
 *             recordados y la vinculación de uno nuevo.
 */
@Component({
  selector: 'app-connect',
  standalone: true,
  imports: [],
  templateUrl: `./connect.component.html`,
  styleUrl: `./connect.component.css`
})
export class ConnectComponent implements OnInit, OnDestroy {

  readonly isAndroid = IS_ANDROID;

  readonly devices = inject(RemoteDevicesService);

  readonly connectionDialogs = inject(ConnectionDialogService);

  readonly paired = this.connectionDialogs.paired;
  
  private readonly libraryService = inject(LibraryService);
  private readonly playlistSync = inject(PlaylistSyncService);
  private readonly router = inject(Router);

  // ---- Android ----
  readonly syncing = signal(false);
  readonly scanning = signal(false);
  private scanCancelled = false;

  // ---- Escritorio ----
  readonly qr = signal('');
  readonly error = signal('');
  readonly hostInfo = signal<StreamInfo | null>(null);
  readonly secondsLeft = signal(0);

  private timer: ReturnType<typeof setInterval> | null = null;

  private expiresAt = 0;

  async ngOnInit(): Promise<void> {

    if (this.isAndroid) {
      return;
    }

    await this.generate();
    await this.loadPaired();

    this.timer = setInterval(() => this.tick(), 1000);
  }

  ngOnDestroy(): void {

    if (this.timer !== null) {
      clearInterval(this.timer);
    }
  }

  // ===========================================================
  // ESCRITORIO
  // ===========================================================

  async generate(): Promise<void> {

    this.error.set('');

    try {

      const info = await invoke<StreamInfo>('get_stream_info');

      const link =
        `${info.url}/?pair=${info.pairingCode}` +
        `&hid=${info.hostId}` +
        `&host=${encodeURIComponent(info.hostName)}`;

      this.hostInfo.set(info);
      this.expiresAt = info.expiresAt;
      this.secondsLeft.set(this.remaining());

      this.qr.set(
        await QRCode.toDataURL(link, { width: 480, margin: 1 })
      );

    } catch (error) {

      this.qr.set('');
      this.error.set(String(error));
    }
  }

  countdown(): string {

    const total = Math.max(0, this.secondsLeft());

    const minutes = Math.floor(total / 60);
    const seconds = total % 60;

    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  private remaining(): number {
    return this.expiresAt - Math.floor(Date.now() / 1000);
  }

  private tick(): void {

    this.secondsLeft.set(this.remaining());

    // El código vencido se reemplaza solo.
    if (this.qr() && this.remaining() <= 0) {
      void this.generate();
    }

    // La lista de teléfonos se refresca cada 4 segundos.
    if (Math.floor(Date.now() / 1000) % 4 === 0) {
      void this.loadPaired();
    }
  }

  async loadPaired(): Promise<void> {
    await this.connectionDialogs.loadPaired();
  }

  async revoke(device: PairedDevice): Promise<void> {
    this.connectionDialogs.requestRevoke(device);
  }

  agoSeconds(unixSeconds: number): string {

    return unixSeconds > 0
      ? this.ago(unixSeconds * 1000)
      : 'nunca';
  }

  // ===========================================================
  // ANDROID
  // ===========================================================

  async scan(): Promise<void> {
    if (this.scanning()) return;

    this.scanning.set(true);
    this.scanCancelled = false;
    this.devices.lastError.set('');

    try {
      const scanner = await import('@tauri-apps/plugin-barcode-scanner');

      let permission = await scanner.checkPermissions();

      if (permission !== 'granted') {
        permission = await scanner.requestPermissions();
      }

      if (permission !== 'granted') {
        this.devices.lastError.set(
          'Se necesita permiso de cámara para escanear.'
        );
        return;
      }

      const result = await scanner.scan({
        windowed: false,
        formats: [scanner.Format.QRCode]
      });

      if (this.scanCancelled || !result.content?.trim()) {
        return;
      }

      await this.pair(result.content);

    } catch (error) {
      if (this.scanCancelled || this.isScanCancellation(error)) {
        return;
      }

      console.error('Error al escanear el código QR:', error);

      this.devices.lastError.set(
        error instanceof Error ? error.message : String(error)
      );

    } finally {
      this.scanning.set(false);
    }
  }

  async cancelScan(): Promise<void> {
    if (!this.scanning()) return;

    this.scanCancelled = true;

    try {
      const scanner = await import('@tauri-apps/plugin-barcode-scanner');
      await scanner.cancel();
    } catch (error) {
      console.error('No se pudo cancelar el escaneo:', error);
    }
  }

  private isScanCancellation(error: unknown): boolean {
    const message = String(error).toLowerCase();

    return message.includes('cancel')
      || message.includes('cancelled')
      || message.includes('canceled');
  }

  async pair(link: string): Promise<void> {

    if (!link.trim()) {
      return;
    }

    try {

      const device = await this.devices.pairFromLink(link);

      await this.connectAndSync(device.hostId);

      await this.router.navigateByUrl('/library');

    } catch {
      /* el mensaje queda en devices.lastError */
    }
  }

  async useDevice(device: RemoteDevice): Promise<void> {

    this.devices.activate(device.hostId);

    await this.connectAndSync(device.hostId);
  }

  async connectAndSync(hostId: string): Promise<void> {

    this.syncing.set(true);

    try {

      const state = await this.devices.check(hostId);

      if (state !== 'connected') {
        return;
      }

      await this.libraryService.scanLibrary();

      await this.playlistSync.pull();

    } finally {

      this.syncing.set(false);
    }
  }

  forget(device: RemoteDevice): void {
    this.connectionDialogs.requestForget(device);
  }

  stateOf(device: RemoteDevice): ConnectionState {
    return this.devices.states()[device.hostId] ?? 'checking';
  }

  // ===========================================================
  // PRESENTACIÓN
  // ===========================================================

  label(state: ConnectionState | null): string {

    switch (state) {
      case 'connected': return 'Conectado';
      case 'offline': return 'Sin conexión';
      case 'revoked': return 'Acceso revocado';
      default: return 'Conectando…';
    }
  }

  dotClass(state: ConnectionState | null): string {

    switch (state) {
      case 'connected': return 'bg-[var(--musex-accent)] shadow-[0_0_8px_var(--musex-accent)]';
      case 'offline': return 'bg-red-400';
      case 'revoked': return 'bg-white/30';
      default: return 'animate-pulse bg-amber-300';
    }
  }

  textClass(state: ConnectionState | null): string {

    switch (state) {
      case 'connected': return 'text-[var(--musex-accent)]';
      case 'offline': return 'text-red-300';
      case 'revoked': return 'text-white/50';
      default: return 'text-amber-300';
    }
  }

  activeCardClass(): string {

    switch (this.devices.activeState()) {
      case 'connected': return 'border-[var(--musex-accent)]/25 bg-[var(--musex-accent)]/[0.04]';
      case 'offline': return 'border-red-400/20 bg-red-400/[0.04]';
      default: return 'border-white/[0.07] bg-[#131517]';
    }
  }

  ago(timestamp: number): string {

    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));

    if (seconds < 60) return 'hace un momento';

    const minutes = Math.floor(seconds / 60);

    if (minutes < 60) return `hace ${minutes} min`;

    const hours = Math.floor(minutes / 60);

    if (hours < 24) return `hace ${hours} h`;

    const days = Math.floor(hours / 24);

    return days === 1 ? 'ayer' : `hace ${days} días`;
  }
}