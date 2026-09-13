import { Routes } from '@angular/router';

import { MainLayoutComponent } from './layouts/main-layout/main-layout.component';

import { HomeComponent } from './pages/home/home.component';
import { ExploreComponent } from './pages/explore/explore.component';
import { LibraryComponent } from './pages/library/library.component';
import { FavoritesComponent } from './pages/favorites/favorites.component';
import { DownloadsComponent } from './pages/downloads/downloads.component';
import { HistoryComponent } from './pages/history/history.component';

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
        redirectTo: 'home'
      },

      {
        path: 'home',
        component: HomeComponent,
        title: 'Inicio | Musex'
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
        component: LibraryComponent,
        title: 'Mi biblioteca | Musex'
      },


      // --------------------------------------------------------
      // FAVORITES
      // --------------------------------------------------------

      {
        path: 'favorites',
        component: FavoritesComponent,
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
      // HISTORY
      // --------------------------------------------------------

      {
        path: 'history',
        component: HistoryComponent,
        title: 'Historial | Musex'
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