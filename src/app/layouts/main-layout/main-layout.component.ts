import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { TopBarComponent } from '../../components/top-bar/top-bar.component';
import { SidebarComponent } from '../../components/sidebar/sidebar.component';
import { NowPlayingComponent } from '../../components/now-playing/now-playing.component';
import { BottomPlayerComponent } from '../../components/bottom-player/bottom-player.component';
import { ModalComponent } from '../../components/modal/modal.component';
import { ToastContainerComponent } from '../../components/toast-container/toast-container.component';
import { QueuePanelComponent } from '../../components/queue-panel/queue-panel.component';

/**
 * Layout principal de Musex.
 *
 * Mantiene las zonas persistentes de la aplicación mientras
 * Angular cambia únicamente el contenido del RouterOutlet.
 *
 * Esto permite que elementos como el reproductor, la barra
 * lateral y el estado actual de reproducción permanezcan
 * disponibles al navegar entre las diferentes páginas.
 */
@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [
    RouterOutlet,
    TopBarComponent,
    SidebarComponent,
    NowPlayingComponent,
    BottomPlayerComponent,
    ModalComponent,
    ToastContainerComponent,
    QueuePanelComponent
  ],
  templateUrl: './main-layout.component.html',
  styleUrl: './main-layout.component.css'
})
export class MainLayoutComponent {

}