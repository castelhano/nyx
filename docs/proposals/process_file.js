var linhas = {};
function processFile(){
    linhas = {};
    let file = document.getElementById('id_file').files;
    let cnsl = document.getElementById('cnsl');
    let linhas_container = document.getElementById('linhas_container');
    cnsl.innerHTML = '';
    linhas_container.innerHTML = '';
    let prefixo = null;

    var fr = new FileReader();

    fr.onload = function(){
        cnsl.innerHTML = 'Aguarde, processando arquivo...';
        let raw = fr.result;
        var file_size = 0;
        var linhas_size = 0;
        var error = false;
        var warnings = [];
        var errors = [];
        try{
            var rows = raw.split('\n');
            file_size = rows.length;
            let row_size = rows[0].split(';').length || null;
            if(file_size < 1 || row_size < 27 || row_size > 29){
                error = true;
                cnsl.innerHTML = 'Arquivo em formato inválido....';
            }
            else{
                prefixo = rows[0].split(';')[22];
                for(let i = 0; i < file_size; i++){
                    let row = rows[i].split(';');
                    if(row[0] == "" || row[0] == "\n" || row[0] == "\r" ){}
                    else if(linhas[`${row[0]}`] !== undefined){
                        if(row[9] == '1'){
                            row[12] = row[12] == '0000' ? '2359' : timeAdd(row[12],0,-1);

                            let tab = parseInt(row[4]);
                            if(!tab) errors.push(`ERRO: Tab ${row[4]} tem formato inválido — linha ${row[0]}`);
                            if(!parseInt(row[22])) warnings.push(`ATENÇÃO: Tab ${row[4]} linha ${row[0]} sem veículo escalado`);

                            linhas[`${row[0]}`].push(row);
                        }
                    }
                    else{
                        if(row[9] == '1'){
                            row[12] = timeAdd(row[12],0,-1);

                            let tab = parseInt(row[4]);
                            if(!tab) errors.push(`ERRO: Tab ${row[4]} tem formato inválido — linha ${row[0]}`);
                            if(!parseInt(row[22])) warnings.push(`ATENÇÃO: Tab ${row[4]} linha ${row[0]} sem veículo escalado`);

                            linhas[`${row[0]}`] = [row];
                            linhas_size++;
                            let item_onclick = `onclick="linhaPreview('${row[0]}')"`
                            let list_item = `<li data-value="${row[0]}" ${item_onclick}>${row[0]}</li>`;
                            linhas_container.innerHTML += list_item;
                        }
                    }
                }
                if(APP_CONFIG.autoSelectCompany){
                    try{
                        let initial = String(parseInt(prefixo))[0];
                        if(initial in APP_CONFIG.company){
                            document.getElementById('id_empresa').value = APP_CONFIG.company[initial];
                        }
                    }catch(e){console.log(e);}
                }
            }
        }
        catch(e){console.log(e);}

        if(!error){
            document.getElementById('section-work').classList.remove('d-none');
            document.getElementById('btnGerarTodos').classList.remove('d-none');

            let errorsUnq = [...new Set(errors)];
            let warningsUnq = [...new Set(warnings)];

            cnsl.innerHTML =
                `<b>Análise concluída</b> — <b>${floatFormat(file_size)}</b> registros em <b>${linhas_size}</b> linhas` +
                `<br><span class="cnsl-sep">──────────────────────────────</span><br>`;

            for(const msg of errorsUnq){ cnsl.innerHTML += `<span class="cnsl-error">${msg}</span><br>`; }
            for(const msg of warningsUnq){ cnsl.innerHTML += `<span class="cnsl-warning">${msg}</span><br>`; }

            if(!errorsUnq.length && !warningsUnq.length){
                cnsl.innerHTML += 'Nenhuma inconsistência encontrada.<br>';
            }

            cnsl.innerHTML +=
                `<br>Selecione uma linha para pré-visualizar ou clique em ` +
                `<button class="btn btn-primary" onclick="gerarTodos()" style="padding:3px 10px;">Gerar todos</button>`;
        }
    }

    fr.readAsText(file[0]);
}
