from nyx.framework.registry import get_all, get_app_ui


def nyx_nav(request):
    if not request.user.is_authenticated:
        return {}

    registry = get_all()
    current_view = getattr(getattr(request, 'resolver_match', None), 'view_name', '')
    groups = {}  # { app_label_short: { label, app_ui, items } }

    for model_class, entry in registry.items():
        if entry.parent is not None:
            continue

        app_label  = model_class._meta.app_label
        model_name = model_class._meta.model_name
        perm       = f"{app_label}.view_{model_name}"

        if not (request.user.is_superuser or request.user.has_perm(perm)):
            continue

        url_prefix = entry.list_url[:-4]

        ui = entry.ui
        raw_icon = getattr(ui, 'icon', None) if ui else None
        if raw_icon:
            icon         = raw_icon
            icon_is_char = False
        else:
            icon         = str(model_class._meta.verbose_name_plural)[0].upper()
            icon_is_char = True

        if app_label not in groups:
            groups[app_label] = {
                'label':  entry.app_label,
                'app_ui': get_app_ui(app_label),
                'items':  [],
            }

        groups[app_label]['items'].append({
            'entry':        entry,
            'label':        str(model_class._meta.verbose_name_plural).capitalize(),
            'active':       current_view.startswith(url_prefix),
            'icon':         icon,
            'icon_is_char': icon_is_char,
        })

    return {'nav_groups': list(groups.values())}
