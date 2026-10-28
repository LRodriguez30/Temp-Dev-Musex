// =============================================================
// REGISTRO DE DISPOSITIVOS VINCULADOS
// =============================================================
//
// Lógica pura (sin Tauri ni axum) para poder probarla aparte.
//
// Cómo funciona la vinculación:
//
//   1. El escritorio genera un CÓDIGO DE VINCULACIÓN de un solo uso
//      (dura 5 minutos) y lo muestra dentro del QR.
//   2. El teléfono, que tiene un ID propio y único por instalación,
//      envía el código + su ID.
//   3. Si el código es válido se CONSUME (nadie más puede usarlo) y
//      el escritorio crea un TOKEN propio para ese teléfono.
//   4. Desde entonces cada teléfono usa SU token. Si se revoca, solo
//      ese teléfono pierde acceso.
//
// Todo pasa dentro de un Mutex: dos teléfonos que escaneen el mismo
// QR a la vez no pueden usar el mismo código (sin condiciones de
// carrera).
// =============================================================

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const PAIRING_TTL_SECS: u64 = 300;
pub const ONLINE_WINDOW_SECS: u64 = 45;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairedDevice {
    pub id: String,
    pub name: String,
    pub token: String,
    pub paired_at: u64,
    pub last_seen: u64,
}

/// Lo que ve la interfaz (nunca incluye el token).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairedDeviceInfo {
    pub id: String,
    pub name: String,
    pub paired_at: u64,
    pub last_seen: u64,
    pub online: bool,
}

#[derive(Debug, PartialEq)]
pub enum PairError {
    /// Código inexistente, vencido o ya usado.
    InvalidCode,
    /// Faltan datos del dispositivo.
    BadRequest,
    Internal(String),
}

struct Pairing {
    code: String,
    expires_at: u64,
}

pub struct Registry {
    file: Option<PathBuf>,
    host_id: String,
    host_name: String,
    devices: Vec<PairedDevice>,
    pairing: Option<Pairing>,
}

/// Aleatorio criptográfico (del sistema operativo).
pub fn random_hex(bytes: usize) -> Result<String, String> {
    let mut buffer = vec![0u8; bytes];

    getrandom::getrandom(&mut buffer)
        .map_err(|error| format!("No se pudo generar un valor aleatorio: {error}"))?;

    Ok(buffer.iter().map(|byte| format!("{byte:02x}")).collect())
}

impl Registry {
    /// Carga (o crea) el registro guardado en `base_dir`.
    pub fn load(base_dir: &Path) -> Result<Self, String> {
        let file = base_dir.join("paired_devices.json");

        let devices = std::fs::read_to_string(&file)
            .ok()
            .and_then(|raw| serde_json::from_str::<Vec<PairedDevice>>(&raw).ok())
            .unwrap_or_default();

        let host_file = base_dir.join("host_id.txt");

        let host_id = match std::fs::read_to_string(&host_file) {
            Ok(saved) if saved.trim().len() >= 16 => saved.trim().to_string(),
            _ => {
                let id = random_hex(16)?;
                let _ = std::fs::write(&host_file, &id);
                id
            }
        };

        let host_name = std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| "Musex".to_string());

        Ok(Self {
            file: Some(file),
            host_id,
            host_name,
            devices,
            pairing: None,
        })
    }

    /// Registro en memoria (para pruebas).
    #[cfg(test)]
    pub fn in_memory() -> Self {
        Self {
            file: None,
            host_id: "host-test".to_string(),
            host_name: "PC".to_string(),
            devices: Vec::new(),
            pairing: None,
        }
    }

    pub fn host(&self) -> (String, String) {
        (self.host_id.clone(), self.host_name.clone())
    }

    fn save(&self) {
        let Some(file) = &self.file else { return };

        if let Ok(json) = serde_json::to_string_pretty(&self.devices) {
            let _ = std::fs::write(file, json);
        }
    }

    /// Genera un código nuevo. El anterior deja de valer.
    pub fn begin_pairing(&mut self, now: u64) -> Result<(String, u64), String> {
        let code = random_hex(10)?;
        let expires_at = now + PAIRING_TTL_SECS;

        self.pairing = Some(Pairing {
            code: code.clone(),
            expires_at,
        });

        Ok((code, expires_at))
    }

    /// Canjea el código por un token propio del dispositivo.
    pub fn complete_pairing(
        &mut self,
        code: &str,
        device_id: &str,
        device_name: &str,
        now: u64,
    ) -> Result<String, PairError> {
        let device_id = device_id.trim();

        if device_id.is_empty() || device_id.len() > 100 {
            return Err(PairError::BadRequest);
        }

        let valid = matches!(
            &self.pairing,
            Some(pairing) if pairing.code == code && now <= pairing.expires_at
        );

        if !valid {
            return Err(PairError::InvalidCode);
        }

        // El código se consume: sirve para un solo dispositivo.
        self.pairing = None;

        let token = random_hex(24).map_err(PairError::Internal)?;

        let name = {
            let trimmed = device_name.trim();

            if trimmed.is_empty() {
                "Teléfono".to_string()
            } else {
                trimmed.chars().take(60).collect()
            }
        };

        match self.devices.iter().position(|device| device.id == device_id) {
            // El mismo teléfono vuelve a vincularse: se reemplaza su token.
            Some(index) => {
                let device = &mut self.devices[index];
                device.token = token.clone();
                device.name = name;
                device.paired_at = now;
                device.last_seen = now;
            }

            None => self.devices.push(PairedDevice {
                id: device_id.to_string(),
                name,
                token: token.clone(),
                paired_at: now,
                last_seen: now,
            }),
        }

        self.save();

        Ok(token)
    }

    /// ¿Este token pertenece a un dispositivo vinculado?
    /// Si sí, registra su última actividad.
    pub fn authorize(&mut self, token: &str, now: u64) -> bool {
        if token.is_empty() {
            return false;
        }

        match self.devices.iter_mut().find(|device| device.token == token) {
            Some(device) => {
                device.last_seen = now;
                true
            }

            None => false,
        }
    }

    pub fn revoke(&mut self, id: &str) -> bool {
        let before = self.devices.len();

        self.devices.retain(|device| device.id != id);

        let removed = self.devices.len() != before;

        if removed {
            self.save();
        }

        removed
    }

    pub fn list(&self, now: u64) -> Vec<PairedDeviceInfo> {
        self.devices
            .iter()
            .map(|device| PairedDeviceInfo {
                id: device.id.clone(),
                name: device.name.clone(),
                paired_at: device.paired_at,
                last_seen: device.last_seen,
                online: device.last_seen > 0
                    && now.saturating_sub(device.last_seen) <= ONLINE_WINDOW_SECS,
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pair(registry: &mut Registry, device: &str, now: u64) -> String {
        let (code, _) = registry.begin_pairing(now).unwrap();
        registry
            .complete_pairing(&code, device, "Pixel", now)
            .unwrap()
    }

    #[test]
    fn el_codigo_solo_se_puede_usar_una_vez() {
        let mut registry = Registry::in_memory();
        let (code, _) = registry.begin_pairing(1_000).unwrap();

        assert!(registry.complete_pairing(&code, "tel-a", "A", 1_001).is_ok());

        // Un segundo teléfono con el mismo QR es rechazado.
        assert_eq!(
            registry.complete_pairing(&code, "tel-b", "B", 1_002),
            Err(PairError::InvalidCode)
        );
    }

    #[test]
    fn el_codigo_vence() {
        let mut registry = Registry::in_memory();
        let (code, expires_at) = registry.begin_pairing(1_000).unwrap();

        assert_eq!(expires_at, 1_000 + PAIRING_TTL_SECS);
        assert_eq!(
            registry.complete_pairing(&code, "tel-a", "A", expires_at + 1),
            Err(PairError::InvalidCode)
        );
    }

    #[test]
    fn un_codigo_nuevo_invalida_el_anterior() {
        let mut registry = Registry::in_memory();
        let (old, _) = registry.begin_pairing(1_000).unwrap();
        let (new, _) = registry.begin_pairing(1_010).unwrap();

        assert_ne!(old, new);
        assert_eq!(
            registry.complete_pairing(&old, "tel-a", "A", 1_011),
            Err(PairError::InvalidCode)
        );
        assert!(registry.complete_pairing(&new, "tel-a", "A", 1_011).is_ok());
    }

    #[test]
    fn cada_dispositivo_tiene_su_propio_token() {
        let mut registry = Registry::in_memory();

        let token_a = pair(&mut registry, "tel-a", 1_000);
        let token_b = pair(&mut registry, "tel-b", 1_000);

        assert_ne!(token_a, token_b);
        assert!(registry.authorize(&token_a, 1_005));
        assert!(registry.authorize(&token_b, 1_005));
        assert!(!registry.authorize("inventado", 1_005));
        assert!(!registry.authorize("", 1_005));
    }

    #[test]
    fn vincular_otra_vez_el_mismo_telefono_no_duplica() {
        let mut registry = Registry::in_memory();

        let first = pair(&mut registry, "tel-a", 1_000);
        let second = pair(&mut registry, "tel-a", 2_000);

        assert_eq!(registry.list(2_000).len(), 1);

        // El token anterior ya no sirve.
        assert!(!registry.authorize(&first, 2_001));
        assert!(registry.authorize(&second, 2_001));
    }

    #[test]
    fn revocar_solo_afecta_a_ese_dispositivo() {
        let mut registry = Registry::in_memory();

        let token_a = pair(&mut registry, "tel-a", 1_000);
        let token_b = pair(&mut registry, "tel-b", 1_000);

        assert!(registry.revoke("tel-a"));
        assert!(!registry.revoke("tel-a"));

        assert!(!registry.authorize(&token_a, 1_001));
        assert!(registry.authorize(&token_b, 1_001));
    }

    #[test]
    fn el_estado_en_linea_depende_de_la_ultima_actividad() {
        let mut registry = Registry::in_memory();
        let token = pair(&mut registry, "tel-a", 1_000);

        assert!(registry.list(1_000 + ONLINE_WINDOW_SECS)[0].online);
        assert!(!registry.list(1_000 + ONLINE_WINDOW_SECS + 1)[0].online);

        registry.authorize(&token, 5_000);
        assert!(registry.list(5_010)[0].online);
    }

    #[test]
    fn rechaza_datos_incompletos() {
        let mut registry = Registry::in_memory();
        let (code, _) = registry.begin_pairing(1_000).unwrap();

        assert_eq!(
            registry.complete_pairing(&code, "   ", "A", 1_001),
            Err(PairError::BadRequest)
        );

        // El código sigue disponible tras un intento mal formado.
        assert!(registry.complete_pairing(&code, "tel-a", "", 1_002).is_ok());
        assert_eq!(registry.list(1_002)[0].name, "Teléfono");
    }

    #[test]
    fn se_guarda_y_se_recupera_del_disco() {
        let dir = std::env::temp_dir().join(format!("musex-test-{}", random_hex(6).unwrap()));
        std::fs::create_dir_all(&dir).unwrap();

        let token = {
            let mut registry = Registry::load(&dir).unwrap();
            let (code, _) = registry.begin_pairing(1_000).unwrap();
            registry.complete_pairing(&code, "tel-a", "A", 1_001).unwrap()
        };

        let mut reloaded = Registry::load(&dir).unwrap();
        assert!(reloaded.authorize(&token, 1_002));

        // El ID del equipo se mantiene entre reinicios.
        let first_host = Registry::load(&dir).unwrap().host().0;
        let second_host = Registry::load(&dir).unwrap().host().0;
        assert_eq!(first_host, second_host);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn los_tokens_son_distintos_y_largos() {
        let a = random_hex(24).unwrap();
        let b = random_hex(24).unwrap();

        assert_eq!(a.len(), 48);
        assert_ne!(a, b);
    }
}