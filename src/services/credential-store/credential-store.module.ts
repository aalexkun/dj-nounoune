import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { CredentialStoreService } from './credential-store.service';
import { ProviderCredential, ProviderCredentialSchema } from '../../schemas/provider-credential.schema';

/**
 * Imported by the three provider modules and by `AppModule`.
 *
 * `AppModule` needs it because the `auth import-sessions` CLI subcommand is a root provider, and a
 * root provider can only see what a root import exports.
 */
@Module({
  imports: [ConfigModule, MongooseModule.forFeature([{ name: ProviderCredential.name, schema: ProviderCredentialSchema }])],
  providers: [CredentialStoreService],
  exports: [CredentialStoreService],
})
export class CredentialStoreModule {}
