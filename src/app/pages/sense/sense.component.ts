import { 
  Component, 
  OnInit, 
  signal, 
  computed, 
  inject 
} from '@angular/core'; 
 
import { 
  SenseCapabilityKey, 
  SenseService 
} from '../../core/services/sense.service'; 
 
import { ModalService } from '../../core/services/modal.service'; 
 
type ConnectionStatus = 
  | 'idle' 
  | 'connected' 
  | 'error'; 
 
interface TutorialStep { 
  title: string; 
  description: string; 
} 
 
@Component({ 
  selector: 'app-sense', 
  standalone: true, 
  imports: [], 
  templateUrl: './sense.component.html', 
  styleUrl: './sense.component.css', 
}) 
export class SenseComponent implements OnInit { 
 
  // ============================================================ 
  // SERVICIOS 
  // ============================================================ 
 
  private readonly sense = 
    inject(SenseService); 
 
  private readonly modalService = 
    inject(ModalService); 
 
 
  // ============================================================ 
  // SENSE STATE 
  // ============================================================ 
 
  /** 
   * Estado global de Sense. 
   * 
   * No duplicamos estos datos localmente. 
   * SenseService es la única fuente de verdad. 
   */ 
  readonly settings = 
    this.sense.settings; 
 
  /** 
   * Estado global de activación de Sense. 
   * 
   * Representa únicamente `settings.enabled`. 
   * 
   * Las capacidades individuales, como el asistente 
   * de ecualización, se controlan por separado. 
   */ 
  readonly senseEnabled = 
    computed(() => 
      this.settings().enabled 
    ); 
 
  readonly hasApiKey = 
    computed(() => 
      this.settings().hasApiKey 
    ); 
 
  readonly recommendationsEnabled = 
    computed(() => 
      this.settings().capabilities.recommendations 
    ); 
 
  readonly eqEnabled = 
    computed(() => 
      this.settings().capabilities.eqAssistant 
    ); 
 
  readonly libraryAnalysisEnabled = 
    computed(() => 
      this.settings().capabilities.libraryAnalysis 
    ); 
 
  readonly provider = 
    signal<'gemini'>('gemini'); 
 
 
  // ============================================================ 
  // CONNECTION 
  // ============================================================ 
 
  /** 
   * Estado visual de la conexión. 
   * 
   * No representa el estado permanente de Sense; 
   * únicamente el resultado de la última prueba. 
   */ 
  readonly apiKeyInput = 
    signal(''); 
 
  readonly showApiKey = 
    signal(false); 
 
  readonly testingConnection = 
    signal(false); 
 
  readonly connectionStatus = 
    signal<ConnectionStatus>('idle'); 
 
 
  // ============================================================ 
  // PROMPT EDITING 
  // ============================================================ 
 
  /** 
   * Capacidad cuyo prompt se está editando. 
   */ 
  readonly editingPrompt = 
    signal<SenseCapabilityKey | null>(null); 
 
  /** 
   * Copia temporal del prompt. 
   * 
   * No se persiste en cada tecla. 
   */ 
  readonly draftPrompt = 
    signal(''); 
 
  readonly savingPrompt = 
    signal(false); 
 
 
  // ============================================================ 
  // TUTORIAL 
  // ============================================================ 
 
  readonly tutorialOpen = 
    signal(false); 
 
  readonly tutorialSteps: TutorialStep[] = [ 
 
    { 
      title: 'Abre Google AI Studio', 
      description: 
        'Ve a aistudio.google.com con tu cuenta de Google. Es gratuito y no requiere tarjeta para empezar.', 
    }, 
 
    { 
      title: 'Genera una API Key', 
      description: 
        'Dentro de AI Studio, busca "Get API Key" en el menú lateral y crea una nueva clave para un proyecto nuevo o existente.', 
    }, 
 
    { 
      title: 'Copia la clave', 
      description: 
        'Google te mostrará la clave de forma completa. Cópiala y mantenla privada.', 
    }, 
 
    { 
      title: 'Pégala aquí en Musex', 
      description: 
        'Vuelve a esta pantalla, pega la clave y presiona "Probar conexión" para guardarla y verificarla.', 
    } 
 
  ]; 
 
 
  toggleTutorial(): void { 
 
    this.tutorialOpen.update( 
      open => !open 
    ); 
  } 
 
 
  // ============================================================ 
  // INITIALIZATION 
  // ============================================================ 
 
  async ngOnInit(): Promise<void> { 
 
    await this.sense.ensureLoaded(); 
  } 
 
 
  // ============================================================ 
  // SENSE TOGGLE 
  // ============================================================ 
 
  async toggleSense(): Promise<void> { 
 
    try { 
 
      await this.sense.toggleEnabled(); 
 
    } catch (error) { 
 
      console.error( 
        'No se pudo actualizar el estado de Sense:', 
        error 
      ); 
    } 
  } 
 
 
  // ============================================================ 
  // API KEY 
  // ============================================================ 
 
  onApiKeyInput( 
    event: Event 
  ): void { 
 
    const input = 
      event.target as HTMLInputElement; 
 
    this.apiKeyInput.set( 
      input.value 
    ); 
 
    this.connectionStatus.set( 
      'idle' 
    ); 
 
  } 
 
 
  toggleApiKeyVisibility(): void { 
 
    this.showApiKey.update( 
      visible => !visible 
    ); 
  } 
 
 
  async removeApiKey(): Promise<void> { 
 
    try { 
 
      await this.sense.removeApiKey(); 
 
      this.apiKeyInput.set(''); 
 
      this.connectionStatus.set( 
        'idle' 
      ); 
 
    } catch (error) { 
 
      console.error( 
        'No se pudo eliminar la API Key:', 
        error 
      ); 
    } 
  } 
 
 
  // ============================================================ 
  // CONNECTION TEST 
  // ============================================================ 
 
  async testConnection(): Promise<void> { 
 
    const key = 
      this.apiKeyInput().trim(); 
 
 
    if ( 
      !key && 
      !this.hasApiKey() 
    ) { 
 
      this.connectionStatus.set( 
        'error' 
      ); 
 
      return; 
    } 
 
 
    this.testingConnection.set( 
      true 
    ); 
 
    this.connectionStatus.set( 
      'idle' 
    ); 
 
 
    try { 
 
      /** 
       * Si el usuario escribió una nueva clave, 
       * primero se guarda. 
       */ 
      if (key) { 
 
        await this.sense.saveApiKey( 
          key 
        ); 
 
        this.apiKeyInput.set(''); 
      } 
 
 
      /** 
       * Después se prueba la conexión 
       * utilizando la clave almacenada. 
       */ 
      await this.sense.testConnection(); 
 
 
      this.connectionStatus.set( 
        'connected' 
      ); 
 
    } catch (error) { 
 
      console.error( 
        'Fallo al conectar con Gemini:', 
        error 
      ); 
 
      this.connectionStatus.set( 
        'error' 
      ); 
 
    } finally { 
 
      this.testingConnection.set( 
        false 
      ); 
    } 
  } 
 
 
  // ============================================================ 
  // CAPABILITIES 
  // ============================================================ 
 
  toggleRecommendations(): void { 
 
    void this.sense 
      .toggleCapability( 
        'recommendations' 
      ) 
      .catch(error => 
        console.error( 
          'No se pudo actualizar la capacidad:', 
          error 
        ) 
      ); 
  } 
 
 
  toggleEq(): void { 
 
    void this.sense 
      .toggleCapability( 
        'eq_assistant' 
      ) 
      .catch(error => 
        console.error( 
          'No se pudo actualizar la capacidad:', 
          error 
        ) 
      ); 
  } 
 
 
  toggleLibraryAnalysis(): void { 
 
    void this.sense 
      .toggleCapability( 
        'library_analysis' 
      ) 
      .catch(error => 
        console.error( 
          'No se pudo actualizar la capacidad:', 
          error 
        ) 
      ); 
  } 
 
 
  // ============================================================ 
  // PROMPTS 
  // ============================================================ 
 
  isEditingPrompt( 
    key: SenseCapabilityKey 
  ): boolean { 
 
    return this.editingPrompt() === key; 
  } 
 
 
  /** 
   * Abre o cierra el editor de una capacidad. 
   * 
   * Al abrirlo, copiamos el prompt persistido 
   * al borrador local. 
   */ 
  togglePromptEditor( 
    key: SenseCapabilityKey 
  ): void { 
 
    if ( 
      this.editingPrompt() === key 
    ) { 
 
      this.editingPrompt.set( 
        null 
      ); 
 
      return; 
    } 
 
 
    this.draftPrompt.set( 
      this.sense.promptFor(key) 
    ); 
 
    this.editingPrompt.set( 
      key 
    ); 
  } 
 
 
  onPromptInput( 
    event: Event 
  ): void { 
 
    const value = 
      (event.target as HTMLTextAreaElement) 
        .value; 
 
    this.draftPrompt.set( 
      value 
    ); 
  } 
 
 
  async savePrompt( 
    key: SenseCapabilityKey 
  ): Promise<void> { 
 
    this.savingPrompt.set( 
      true 
    ); 
 
 
    try { 
 
      await this.sense.savePrompt( 
        key, 
        this.draftPrompt() 
      ); 
 
      this.editingPrompt.set( 
        null 
      ); 
 
    } catch (error) { 
 
      console.error( 
        'No se pudo guardar el prompt:', 
        error 
      ); 
 
    } finally { 
 
      this.savingPrompt.set( 
        false 
      ); 
    } 
  } 
 
 
  async resetPrompt( 
    key: SenseCapabilityKey 
  ): Promise<void> { 
 
    try { 
 
      await this.sense.resetPrompt( 
        key 
      ); 
 
 
      if ( 
        this.editingPrompt() === key 
      ) { 
 
        this.draftPrompt.set( 
          this.sense.promptFor(key) 
        ); 
      } 
 
    } catch (error) { 
 
      console.error( 
        'No se pudo restaurar el prompt:', 
        error 
      ); 
    } 
  } 
 
 
  // ============================================================ 
  // GOOGLE AI STUDIO 
  // ============================================================ 
 
  /** 
   * Solicita al sistema global de modales 
   * mostrar la confirmación para abandonar Musex 
   * y abrir Google AI Studio. 
   * 
   * Sense no controla ni renderiza el modal. 
   */ 
  openAiStudioConfirmation(): void { 
 
    this.modalService.open( 
      'ai-studio-confirmation', 
      { 
        title: 'Abrir Google AI Studio', 
        subtitle: 
          'Vas a salir temporalmente de Musex y abrir Google AI Studio en tu navegador.' 
      } 
    ); 
  } 
} 