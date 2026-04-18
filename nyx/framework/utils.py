import zoneinfo

def get_timezone_choices():
    # retorna lista de tuplas (valor, rotulo) ordenada
    # return [(tz, tz) for tz in sorted(zoneinfo.available_timezones())]
    tzs = [
        (tz, tz.replace('_', ' ')) 
        for tz in sorted(zoneinfo.available_timezones()) 
        if '/' in tz and not tz.startswith('Etc/')
    ]
    return tzs