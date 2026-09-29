// =============================================================
// SENSE - CREDENCIALES
// =============================================================
//
// La API key de Gemini se guarda en el almacén de credenciales
// del sistema operativo (Windows Credential Manager, Keychain en
// macOS, libsecret en Linux) mediante el crate `keyring`.
//
// Nunca se escribe en un archivo plano ni se expone al frontend:
// el propio backend de Rust la usa directamente para hablar con
// Gemini (ver commands::sense::test_sense_connection).
// =============================================================

use keyring::Entry;

const SERVICE_NAME: &str = "musex-sense";
const ENTRY_NAME: &str = "gemini-api-key";

pub fn save_api_key(key: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, ENTRY_NAME).map_err(|error| error.to_string())?;
    entry.set_password(key).map_err(|error| error.to_string())
}

pub fn get_api_key() -> Option<String> {
    let entry = Entry::new(SERVICE_NAME, ENTRY_NAME).ok()?;
    entry.get_password().ok()
}

pub fn delete_api_key() -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, ENTRY_NAME).map_err(|error| error.to_string())?;

    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}