import { Routes } from '@angular/router';

import { MainLayoutComponent } from './layouts/main-layout/main-layout.component';

import { HomeComponent } from './pages/home/home.component';
import { ExploreComponent } from './pages/explore/explore.component';
import { LibraryComponent } from './pages/library/library.component';
import { FavoritesComponent } from './pages/favorites/favorites.component';
import { DownloadsComponent } from './pages/downloads/downloads.component';
import { HistoryComponent } from './pages/history/history.component';
import { SenseComponent } from './pages/sense/sense.component';
import { EqualizerComponent } from './pages/equalizer/equalizer.component';
import { PlaylistsComponent } from './pages/playlists/playlists.component';
import { ConnectComponent } from './components/connect/connect.component';
import { LibraryMobileComponent } from './pages/library-mobile/library-mobile.component';
import { FavoritesMobileComponent } from './pages/favorites-mobile/favorites-mobile.component';
import { LocalStorageManagerComponent } from './pages/local-storage-manager/local-storage-manager.component';

import { IS_ANDROID, getRemote } from './core/platform/invoke';

/**
 * Configuración principal de rutas de Musex.
 *
 * MainLayoutComponent funciona como contenedor persistente
 * de la aplicación. Las páginas internas se renderizan dentro
 * de su RouterOutlet mediante rutas hijas.
 */
export const routes: Routes = [

  // ============================================================
  // MAIN APPLICATION LAYOUT
  // ============================================================

  {
    path: '',
    component: MainLayoutComponent,

    children: [

      // --------------------------------------------------------
      // HOME
      // --------------------------------------------------------

      {
        path: '',
        pathMatch: 'full',
        redirectTo: () => IS_ANDROID && !getRemote() ? 'connect' : 'home'
      },

      {
        path: 'home',
        component: HomeComponent,
        title: 'Inicio | Musex'
      },

      {
        path: 'connect',
        component: ConnectComponent,
        title: 'Conectar | Musex'
      },

      {
        path: 'playlists',
        component: PlaylistsComponent,
        title: 'Playlists | Musex'
      },


      // --------------------------------------------------------
      // EXPLORE
      // --------------------------------------------------------

      {
        path: 'explore',
        component: ExploreComponent,
        title: 'Explorar | Musex'
      },


      // --------------------------------------------------------
      // LIBRARY
      // --------------------------------------------------------

      {
        path: 'library',
        component: IS_ANDROID ? LibraryMobileComponent : LibraryComponent,
        title: 'Mi biblioteca | Musex'
      },


      // --------------------------------------------------------
      // FAVORITES
      // --------------------------------------------------------

      {
        path: 'favorites',
        component: IS_ANDROID ? FavoritesMobileComponent : FavoritesComponent,
        title: 'Favoritos | Musex'
      },


      // --------------------------------------------------------
      // DOWNLOADS
      // --------------------------------------------------------

      {
        path: 'downloads',
        component: DownloadsComponent,
        title: 'Descargas | Musex'
      },

      // --------------------------------------------------------
      // LOCAL STORAGE
      // --------------------------------------------------------

      {
        path: 'local-storage',
        component: LocalStorageManagerComponent,
        title: 'Archivos locales | Musex'
      },


      // --------------------------------------------------------
      // HISTORY
      // --------------------------------------------------------

      {
        path: 'history',
        component: HistoryComponent,
        title: 'Historial | Musex'
      },

      {
        path: 'equalizer',
        component: EqualizerComponent,
        title: 'Ecualizador | Musex'
      },

      {
        path: 'sense',
        component: SenseComponent,
        title: 'Musex Sense'
      },

      {
        path: 'playlist/:id',
        loadComponent: () =>
          import('./components/playlist-detail/playlist-detail.component')
            .then(m => m.PlaylistDetailComponent)
      },


      // --------------------------------------------------------
      // UNKNOWN ROUTES
      // --------------------------------------------------------

      {
        path: '**',
        redirectTo: 'home'
      }

    ]
  }

];