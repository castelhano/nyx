from nyx.framework.registry import get_all


def nyx_nav(request):
    if not request.user.is_authenticated:
        return {}

    registry = get_all()
    current_view = getattr(getattr(request, 'resolver_match', None), 'view_name', '')
    groups = {}

    for model_class, entry in registry.items():
        if entry.parent is not None:
            continue

        app_label  = model_class._meta.app_label
        model_name = model_class._meta.model_name
        perm       = f"{app_label}.view_{model_name}"

        if not (request.user.is_superuser or request.user.has_perm(perm)):
            continue

        # 'core:empresa_list' -> 'core:empresa_'  (matches list/create/update/delete)
        url_prefix = entry.list_url[:-4]

        groups.setdefault(entry.app_label, []).append({
            'entry':  entry,
            'label':  str(model_class._meta.verbose_name_plural).capitalize(),
            'active': current_view.startswith(url_prefix),
        })

    return {'nav_groups': groups}
