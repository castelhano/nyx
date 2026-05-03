import { Injectable } from '@nestjs/common'
import { AbilityBuilder, createMongoAbility, MongoAbility } from '@casl/ability'

export type AppAbility = MongoAbility

@Injectable()
export class CaslAbilityFactory {
  createForUser(user: { role: string }): AppAbility {
    const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility)

    if (user.role === 'admin') {
      can('manage', 'all')
    } else if (user.role === 'operator') {
      can('read',   'all')
      can('create', ['Company'])
      can('update', ['Company'])
    } else {
      can('read', 'all')
    }

    return build()
  }
}
