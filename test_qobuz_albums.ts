import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { QobuzService } from './src/services/qobuz/qobuz.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const qobuzService = app.get(QobuzService);
  
  await qobuzService.login();

  // Test getting favorite albums
  const response = await qobuzService['signedGet']<any>('/favorite/getUserFavorites', {
    type: 'albums',
    limit: '5',
    offset: '0'
  });
  console.log('Favorite Albums Keys:', Object.keys(response));
  if (response.albums) {
    console.log('Albums items count:', response.albums.items?.length);
  }

  // If there are albums, get the first one's details
  if (response.albums && response.albums.items && response.albums.items.length > 0) {
    const albumId = response.albums.items[0].id;
    console.log(`Getting details for album ${albumId}`);
    const albumDetails = await qobuzService['signedGet']<any>('/album/get', {
      album_id: albumId
    });
    console.log('Album Details Keys:', Object.keys(albumDetails));
    if (albumDetails.tracks) {
      console.log('Tracks count in album:', albumDetails.tracks.items?.length);
      console.log('First track sample:', albumDetails.tracks.items[0].title);
    }
  }
  
  await app.close();
}
bootstrap();
