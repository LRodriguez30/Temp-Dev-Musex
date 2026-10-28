import {
  Injectable,
  computed,
  signal
} from '@angular/core';

import {
  IS_ANDROID,
  setRemote
} from '../platform/invoke';

/** Estado de la conexión con un equipo. */
export type ConnectionState =
  | 'checking'
  | 'connected'
  | 'offline'
  | 'revoked';

/** Un Musex de escritorio al que este teléfono ya se vinculó. */
export interface RemoteDevice {
  hostId: string;
  name: string;
  base: string;
  token: string;
  pairedAt: number;
  lastConnectedAt: number;
}

const DEVICES_KEY = 'musex.devices';
const ACTIVE_KEY = 'musex.activeHost';
const CLIENT_ID_KEY = 'musex.clientId';

const PING_TIMEOUT_MS = 3500;
const RECHECK_INTERVAL_MS = 15_000;

/**
 * Dispositivos de escritorio recordados por este teléfono.
 *
 * - Guarda todos los equipos a los que te vinculaste.
 * - Recuerda el último con el que estuviste conectado y vuelve a
 *   usarlo al abrir la app.
 * - Cada instalación de Musex tiene su propio ID (clientId); el
 *   escritorio le entrega un token propio al vincularse.
 */
@Injectable({
  providedIn: 'root'
})
export class RemoteDevicesService {

  readonly devices = signal<RemoteDevice[]>([]);

  readonly activeHostId = signal<string | null>(null);

  readonly states = signal<Record<string, ConnectionState>>({});

  readonly lastError = signal('');

  readonly busy = signal(false);

  readonly activeDevice = computed(() =>
    this.devices().find(
      device => device.hostId === this.activeHostId()
    ) ?? null
  );

  /** Estado del equipo activo (o null si no hay ninguno). */
  readonly activeState = computed<ConnectionState | null>(() => {

    const active = this.activeDevice();

    return active
      ? this.states()[active.hostId] ?? 'checking'
      : null;
  });

  readonly isConnected = computed(() =>
    this.activeState() === 'connected'
  );

  constructor() {

    if (!IS_ANDROID) {
      return;
    }

    this.restore();

    void this.checkAll();

    setInterval(() => {

      if (!document.hidden) {
        void this.checkAll();
      }

    }, RECHECK_INTERVAL_MS);

    document.addEventListener('visibilitychange', () => {

      if (!document.hidden) {
        void this.checkAll();
      }
    });
  }

  // ===========================================================
  // IDENTIDAD DE ESTA INSTALACIÓN
  // ===========================================================

  /** ID único de esta instalación (se crea la primera vez). */
  clientId(): string {

    try {

      const saved = localStorage.getItem(CLIENT_ID_KEY);

      if (saved) {
        return saved;
      }

      const created = crypto.randomUUID();

      localStorage.setItem(CLIENT_ID_KEY, created);

      return created;

    } catch {

      return 'temporal-' + Math.random().toString(36).slice(2);
    }
  }

  /** Nombre con el que el escritorio muestra este teléfono. */
  clientName(): string {

    const match = navigator.userAgent.match(/;\s*([^;)]+?)\s+Build\//);

    return match?.[1]?.trim() || 'Teléfono Android';
  }

  // ===========================================================
  // VINCULAR
  // ===========================================================

  /**
   * Vincula este teléfono con el equipo del código QR.
   *
   * El QR trae: dirección, código de un solo uso, ID y nombre
   * del equipo. A cambio el escritorio entrega un token propio.
   */
  async pairFromLink(link: string): Promise<RemoteDevice> {

    this.busy.set(true);
    this.lastError.set('');

    try {

      const url = new URL(link.trim());

      const code = url.searchParams.get('pair');
      const hostId = url.searchParams.get('hid');
      const hostName = url.searchParams.get('host') ?? 'Musex';

      if (!code || !hostId) {
        throw new Error('El código QR no es válido.');
      }

      const base = `${url.protocol}//${url.host}`;

      const response = await this.fetchWithTimeout(
        `${base}/pair`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pairingCode: code,
            deviceId: this.clientId(),
            deviceName: this.clientName()
          })
        },
        6000
      );

      if (response.status === 401) {
        throw new Error(
          'El código venció o ya se usó. Genera uno nuevo en el escritorio.'
        );
      }

      if (!response.ok) {
        throw new Error(
          `El escritorio respondió ${response.status}.`
        );
      }

      const result = await response.json() as {
        token: string;
        hostId: string;
        hostName: string;
      };

      const now = Date.now();

      const device: RemoteDevice = {
        hostId: result.hostId || hostId,
        name: result.hostName || hostName,
        base,
        token: result.token,
        pairedAt: now,
        lastConnectedAt: now
      };

      this.upsert(device);
      this.activate(device.hostId);

      return device;

    } catch (error) {

      this.lastError.set(this.messageOf(error));

      throw error;

    } finally {

      this.busy.set(false);
    }
  }

  // ===========================================================
  // ADMINISTRAR
  // ===========================================================

  /** Usa este equipo como el activo. */
  activate(hostId: string): void {

    const device = this.devices().find(
      item => item.hostId === hostId
    );

    if (!device) {
      return;
    }

    this.activeHostId.set(hostId);

    try {
      localStorage.setItem(ACTIVE_KEY, hostId);
    } catch { /* sin almacenamiento */ }

    setRemote({
      base: device.base,
      token: device.token
    });

    this.setState(hostId, 'checking');

    void this.check(hostId);
  }

  /** Olvida un equipo (no avisa al escritorio). */
  forget(hostId: string): void {

    this.devices.update(devices =>
      devices.filter(device => device.hostId !== hostId)
    );

    this.persist();

    if (this.activeHostId() === hostId) {

      this.activeHostId.set(null);

      try {
        localStorage.removeItem(ACTIVE_KEY);
      } catch { /* sin almacenamiento */ }

      setRemote(null);
    }
  }

  // ===========================================================
  // ESTADO DE LA CONEXIÓN
  // ===========================================================

  async checkAll(): Promise<void> {

    await Promise.all(
      this.devices().map(device =>
        this.check(device.hostId)
      )
    );
  }

  async check(hostId: string): Promise<ConnectionState> {

    const device = this.devices().find(
      item => item.hostId === hostId
    );

    if (!device) {
      return 'offline';
    }

    try {

      const response = await this.fetchWithTimeout(
        `${device.base}/ping?token=${encodeURIComponent(device.token)}`,
        {},
        PING_TIMEOUT_MS
      );

      if (response.status === 401) {

        this.setState(hostId, 'revoked');

        return 'revoked';
      }

      if (!response.ok) {

        this.setState(hostId, 'offline');

        return 'offline';
      }

      this.setState(hostId, 'connected');

      this.touch(hostId);

      return 'connected';

    } catch {

      this.setState(hostId, 'offline');

      return 'offline';
    }
  }

  // ===========================================================
  // INTERNOS
  // ===========================================================

  private restore(): void {

    try {

      const raw = localStorage.getItem(DEVICES_KEY);

      const parsed: unknown = raw ? JSON.parse(raw) : [];

      const devices = Array.isArray(parsed)
        ? (parsed as RemoteDevice[]).filter(device =>
            device &&
            typeof device.hostId === 'string' &&
            typeof device.base === 'string' &&
            typeof device.token === 'string'
          )
        : [];

      this.devices.set(devices);

      const saved = localStorage.getItem(ACTIVE_KEY);

      // Vuelve al último equipo con el que estuviste conectado.
      const last = [...devices].sort(
        (a, b) => b.lastConnectedAt - a.lastConnectedAt
      )[0];

      const active =
        devices.find(device => device.hostId === saved) ?? last;

      if (active) {

        this.activeHostId.set(active.hostId);

        setRemote({
          base: active.base,
          token: active.token
        });

      } else {

        // Restos de versiones anteriores (token único sin equipo).
        setRemote(null);
      }

    } catch {

      this.devices.set([]);
    }
  }

  private upsert(device: RemoteDevice): void {

    this.devices.update(devices => {

      const others = devices.filter(
        item => item.hostId !== device.hostId
      );

      return [device, ...others];
    });

    this.persist();
  }

  private touch(hostId: string): void {

    const now = Date.now();

    this.devices.update(devices =>
      devices.map(device =>
        device.hostId === hostId
          ? { ...device, lastConnectedAt: now }
          : device
      )
    );

    this.persist();
  }

  private setState(
    hostId: string,
    state: ConnectionState
  ): void {

    this.states.update(states => ({
      ...states,
      [hostId]: state
    }));
  }

  private persist(): void {

    try {

      localStorage.setItem(
        DEVICES_KEY,
        JSON.stringify(this.devices())
      );

    } catch { /* sin almacenamiento */ }
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number
  ): Promise<Response> {

    const controller = new AbortController();

    const timer = setTimeout(
      () => controller.abort(),
      timeoutMs
    );

    try {

      return await fetch(url, {
        ...init,
        signal: controller.signal
      });

    } finally {

      clearTimeout(timer);
    }
  }

  private messageOf(error: unknown): string {

    if (error instanceof DOMException && error.name === 'AbortError') {
      return 'No hubo respuesta del escritorio. ¿Está abierto Musex y en la misma red Wi-Fi?';
    }

    if (error instanceof TypeError) {
      return 'No se pudo llegar al escritorio. Revisa que estén en la misma red Wi-Fi.';
    }

    return error instanceof Error
      ? error.message
      : String(error);
  }
}