"""utils.py — Utilitários gerais do framework Nyx."""
import zoneinfo


def get_timezone_choices():
    """Retorna lista de tuplas (valor, rótulo) de fusos horários, excluindo entradas Etc/."""
    tzs = [
        (tz, tz.replace('_', ' ')) 
        for tz in sorted(zoneinfo.available_timezones()) 
        if '/' in tz and not tz.startswith('Etc/')
    ]
    return tzs