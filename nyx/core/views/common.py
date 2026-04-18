from nyx.framework.views import BaseListView
from nyx.core.models.empresa import Empresa


class EmpresaListView(BaseListView):
    model               = Empresa
    permission_required = 'core.view_empresa'