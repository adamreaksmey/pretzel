import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { ApiKeyMiddleware } from './auth/api-key.middleware';
import { ApiKeyEntity } from './auth/api-key.entity';
import { PresenceModule } from './presence/presence.module';
import { TenantEntity } from './tenant/tenant.entity';
import { TenantModule } from './tenant/tenant.module';

function getRequiredDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) {
    return databaseUrl;
  }

  throw new Error('DATABASE_URL environment variable is required.');
}

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: getRequiredDatabaseUrl(),
      entities: [TenantEntity, ApiKeyEntity],
      synchronize: process.env.APP_ENV === 'local',
    }),
    TenantModule,
    AuthModule,
    PresenceModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ApiKeyMiddleware).forRoutes('presence');
  }
}
