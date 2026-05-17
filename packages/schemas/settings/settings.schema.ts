import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

// Schema de registro — usado apenas para discovery e sidebar.
// A página /core/settings é custom; não usa AutoForm/AutoList.
export const settingsPageSchema = withMeta(
  z.object({}),
  {
    label:       'Configurações',
    labelPlural: 'Configurações',
    nameField:   'id',
    icon:        'Settings',
  },
)
