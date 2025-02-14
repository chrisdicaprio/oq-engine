/*
 Copyright (C) 2015-2019 GEM Foundation

 This program is free software: you can redistribute it and/or modify
 it under the terms of the GNU Affero General Public License as
 published by the Free Software Foundation, either version 3 of the
 License, or (at your option) any later version.

 This program is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU Affero General Public License for more details.

 You should have received a copy of the GNU Affero General Public License
 along with this program.  If not, see <https://www.gnu.org/licenses/agpl.html>.
 */

(function ($, Backbone, _) {
    var calculation_table;

    var progressHandlingFunction = function (progress) {
        var percent = progress.loaded / progress.total * 100;
        $('.bar').css('width', percent + '%');
        if (percent == 100) {
            dialog.hide();
        }
    };

    var htmlEscape = function (record) {
        // record[3] is the log message
        record[3] = record[3].replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return record
    };
 
    var dialog = (function ()
                  {
                      var pleaseWaitDiv = $('<div class="modal hide" id="pleaseWaitDialog" data-backdrop="static" data-keyboard="false"><div class="modal-header"><h1>Processing...</h1></div><div class="modal-body"><div class="progress progress-striped active"><div class="bar" style="width: 0%;"></div></div></div></div>');
                      return {
                          show: function (msg, progress) {
                              $('h1', pleaseWaitDiv).text(msg);
                              if (progress) {
                                  progressHandlingFunction({loaded: 0, total: 1});
                              } else {
                                  progressHandlingFunction({loaded: 1, total: 1});
                              }
                              pleaseWaitDiv.modal('show');
                          },
                          hide: function () {
                              pleaseWaitDiv.modal('hide');
                          }
                      };
                  })();

    var diaerror = (function ()
                  {
                      var errorDiv = $('<div id="errorDialog" class="modal hide" data-keyboard="true" tabindex="-1">\
                <div class="modal-dialog">\
                  <div class="modal-content">\
                    <div class="modal-header">\
                      <h4 class="modal-title">Calculation not accepted: traceback</h4>\
                    </div>\
                    <div class="modal-body" style="font-size: 12px;"><pre style="font-size: 12px;" class="modal-body-pre"></pre>\
                    </div>\
                    <div class="modal-footer">\
                      <span id="diaerror_scroll_enabled_box" style="display: none;"><input type="checkbox" id="diaerror_scroll_enabled" checked>\
                      Auto Scroll</span>&nbsp;&nbsp;&nbsp;\
                      <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>\
                    </div>\
                  </div>\
                </div>\
</div>');
                      errorDiv.bind('hide', function () { calculation_table.hide_log(); });
                      return {
                          getdiv: function () {
                              return errorDiv;
                          },

                          show: function (is_large, title, msg) {
                              if (title != null) {
                                  $('.modal-title', errorDiv).html(title);
                              }
                              if (msg != null) {
                                  $('.modal-body-pre', errorDiv).html(msg);
                              }
                              if (is_large) {
                                  errorDiv.addClass("errorDialogLarge");
                              }
                              else {
                                  errorDiv.removeClass("errorDialogLarge");
                              }
                              errorDiv.modal('show');
                          },

                          append: function (title, msg) {
                              if (title != null) {
                                  $('.modal-title', errorDiv).html(title);
                              }
                              $( msg ).appendTo( $('.modal-body-pre', errorDiv) );
                          },

                          scroll_to_bottom: function (ctx) {
                              ctx.scrollTop(ctx[0].scrollHeight);
                          },

                          hide: function () {
                              errorDiv.modal('hide');
                          }
                      };
                  })();

    var CalculationTable = Backbone.View.extend(
        {
            /* the html element where the table is rendered */
            el: $('#my-calculations'),

            logXhr: null,
            logId: -1,
            logIsNew: false,
            logLinesAll: 0,
            logLines: 0,
            logTimeout: null,

            initialize: function (options) {

                /* whatever happens to any calculation, re-render the table */
                _.bindAll(this, 'render');
                this.calculations = options.calculations;
                this.calculations.bind('reset', this.render);
                this.calculations.bind('add', this.render);
                this.calculations.bind('remove', this.render);

                /* if false, it prevents the table to be refreshed */
                this.can_be_rendered = true;

                this.render();
            },

            events: {
                "click .btn-show-remove": "remove_calculation",
                "click .btn-show-abort": "abort_calculation",
                "click .btn-danger": "show_modal_confirm",
                "click .btn-hide-no": "hide_modal_confirm",
                "click .btn-traceback": "show_traceback",
                "click .btn-log": "show_log",
                "click .btn-file": "on_run_risk_clicked",
                "change .btn-file input": "on_run_risk_queued"
            },

            /* When an input dialog is opened, it is very important to not re-render the table */
            on_run_risk_clicked: function (e) {
                /* if a file input dialog has been opened do not refresh the calc table */
                this.can_be_rendered = false;
            },

            on_run_risk_queued: function (e) {
                this.can_be_rendered = true;
            },

            show_modal_confirm: function (e) {
                e.preventDefault();
                var calc_id = $(e.target).attr('data-calc-id');
                
                var show_or_back = (function (e) {
                    this.conf_show = $('#confirmDialog' + calc_id).show();
                    this.back_conf_show = $('.back_confirmDialog' + calc_id).show();
                    closeTimer();
                })();
            },

            hide_modal_confirm: function (e) {
                e.preventDefault();
                var calc_id = $(e.target).attr('data-calc-id');
                
                var hide_or_back = (function (e) {
                    this.conf_hide = $('#confirmDialog' + calc_id).hide();
                    this.back_conf_hide = $('.back_confirmDialog' + calc_id).hide();
                    setTimer();
                })();
            },

            remove_calculation: function (e) {
                e.preventDefault();
                var calc_id = $(e.target).attr('data-calc-id');
                var calc_desc = $(e.target).attr('data-calc-desc');
                var view = this;
                diaerror.show(false, "Removing calculation " + calc_id, "...");

                var hide_or_back = (function (e) {
                    this.conf_hide = $('#confirmDialog' + calc_id).hide();
                    this.back_conf_hide = $('.back_confirmDialog' + calc_id).hide();
                    setTimer();
                })();
                
                var myXhr = $.ajax({url: gem_oq_server_url + "/v1/calc/" + calc_id + "/remove",
                                    type: "POST",
                                    error: function (jqXHR, textStatus, errorThrown) {
                                        if (jqXHR.status == 403) {
                                            diaerror.show(false, "Error", JSON.parse(jqXHR.responseText).error);
                                        }
                                    },
                                    success: function (data, textStatus, jqXHR) {
                                        if(data.error) {
                                            diaerror.show(false, "Error", data.error);
                                        } else {
                                            diaerror.show(false, "Calculation removed", "Calculation <b>(" + calc_id + ") " + calc_desc + "</b> has been removed." );
                                            view.calculations.remove([view.calculations.get(calc_id)]);
                                        }
                                    }});
            },

            abort_calculation: function (e) {
                e.preventDefault();
                var calc_id = $(e.target).attr('data-calc-id');
                var calc_desc = $(e.target).attr('data-calc-desc');
                var view = this;
                diaerror.show(false, "Aborting calculation " + calc_id, "...");

                var hide_or_back = (function (e) {
                    this.conf_hide = $('#confirmDialog' + calc_id).hide();
                    this.back_conf_hide = $('.back_confirmDialog' + calc_id).hide();
                    setTimer();
                })();

                var myXhr = $.ajax({url: gem_oq_server_url + "/v1/calc/" + calc_id + "/abort",
                                    type: "POST",
                                    error: function (jqXHR, textStatus, errorThrown) {
                                        if (jqXHR.status == 403) {
                                            diaerror.show(false, "Error", JSON.parse(jqXHR.responseText).error);
                                        }
                                    },
                                    success: function (data, textStatus, jqXHR) {
                                        if(data.error) {
                                            diaerror.show(false, "Error", data.error );
                                        } else {
                                            diaerror.show(false, "Calculation aborted", "Calculation <b>(" + calc_id + ") " + calc_desc + "</b> has been aborted." );
                                            calculations.fetch({reset: true})
                                        }
                                    }});
            },

            show_traceback: function (e) {
                e.preventDefault();
                var calc_id = $(e.target).attr('data-calc-id');
                var myXhr = $.ajax({url: gem_oq_server_url + "/v1/calc/" + calc_id + "/traceback",
                                    error: function (jqXHR, textStatus, errorThrown) {
                                        if (jqXHR.status == 404) {
                                            diaerror.show(false, "Calculation " + calc_id + " not found.");
                                        }
                                        else {
                                            diaerror.show(false, "Error retrieving traceback for calculation " + calc_id, textStatus);
                                        }
                                        // alert("Error: " + textStatus);
                                    },
                                    success: function (data, textStatus, jqXHR) {
                                        if (data.length == 0) {
                                            diaerror.show(true, "Traceback not found for calculation " + calc_id, []);
                                        }
                                        else {
                                            var out = "";
                                            var ct = 0;
                                            for (s in data) {
                                                if (data[s] == "")
                                                    continue;
                                                out += '<p ' + (ct % 2 == 1 ? 'style="background-color: #ffffff;"' : '') + '>' + data[s] + '</p>';
                                                ct++;
                                            }
                                            diaerror.show(true, "Traceback of calculation " + calc_id, out);
                                        }
                                        // alert("Success: " + textStatus);
                                    }});
            },

            _show_log_priv: function (is_new, calc_id, is_running, from) {
                var was_running = is_running;

                // TO CHECK hide_log method enable console.log and take a look
                // console.log("_show_log_priv: begin");
                if (this.logXhr != null) {
                    this.logXhr.abort();
                    this.logXhr = null;
                }
                if (is_new) {
                    if (this.logTimeout != null) {
                        window.clearTimeout(this.logTimeout);
                        this.logTimeout = null;
                    }
                }
                var obj = this;

                this.logXhr = $.ajax({url: gem_oq_server_url + "/v1/calc/" + calc_id + "/log/" + from + ":",
                                      error: function (jqXHR, textStatus, errorThrown) {
                                          if (jqXHR.status == 404) {
                                              diaerror.show(true, "Log of calculation " + calc_id + " not found.");
                                          }
                                          else {
                                              diaerror.show(true, "Error retrieving log for calculation " + calc_id, textStatus);
                                          }
                                          obj.logIsNew = false;
                                      },
                                      success: function (data, textStatus, jqXHR) {
                                          var delay = 250;

                                          if (is_new) {
                                              obj.logLines = 0;
                                              obj.logLinesAll = 0;
                                          }
                                          else {
                                              // if data is empty check if job is still running
                                              if (is_running) {
                                                  if (data.length == 0) {
                                                      var ajax, status;

                                                      delay = 1000;

                                                      ajax = $.ajax({url: gem_oq_server_url + "/v1/calc/" + calc_id + "/status",
                                                                     async: false}).done(function (data) { status = data.is_running; });
                                                      if (status !== true) {
                                                          is_running = false;
                                                      }
                                                  }
                                              }
                                          }
                                          var out = "";

                                          for (s in data) {
                                              if (data[s] == "") {
                                                  obj.logLinesAll++;
                                                  continue;
                                              }
                                              out += '<p ' + (obj.logLines % 2 == 1 ? 'style="background-color: #ffffff;"' : '') + '>' + htmlEscape(data[s]) + '</p>';
                                              obj.logLines++;
                                              obj.logLinesAll++;
                                          }

                                          var title;
                                          if (is_running) {
                                              var dt;
                                              dt = new Date();
                                              title = "Log of calculation " + calc_id + " - " + dt.toString();
                                          }
                                          else if (was_running != is_running) {
                                              title = "Log of calculation " + calc_id + " - finished";
                                          }
                                          else {
                                              title = "Log of calculation " + calc_id;
                                          }

                                          if (obj.logIsNew) {
                                              diaerror.show(true, title, out);
                                          }
                                          else {
                                              diaerror.append(title, out);
                                          }
                                          if ($("#diaerror_scroll_enabled").prop( "checked" ) || was_running == false) {
                                              diaerror.scroll_to_bottom($('.modal-body', diaerror.getdiv()));
                                          }

                                          if (is_running) {
                                              function log_update(obj)
                                              {
                                                  obj._show_log_priv(false, obj.logId, true, obj.logLinesAll);
                                              }

                                              obj.logTimeout = window.setTimeout(log_update, delay, obj);
                                          }
                                          else {
                                              $('#diaerror_scroll_enabled_box').hide();
                                          }

                                          obj.logIsNew = false;
                                      }});
            },

            show_log: function (e) {
                e.preventDefault();
                var calc_id = $(e.target).attr('data-calc-id');
                var is_running = ($(e.target).attr('is-running') == "true");

                this.logId = calc_id;
                this.logIsNew = true;

                if (is_running)
                    $('#diaerror_scroll_enabled_box', diaerror.getdiv()).show();
                else
                    $('#diaerror_scroll_enabled_box', diaerror.getdiv()).hide();

                this._show_log_priv(true, calc_id, is_running, "0");
            },

            hide_log: function (e) {
                if (this.logTimeout != null) {
                    window.clearTimeout(this.logTimeout);
                    this.logTimeout = null;
                }
                if (this.logXhr != null) {
                    this.logXhr.abort();
                    this.logXhr = null;
                }
                $('#diaerror_scroll_enabled_box').hide();
            },

            render: function () {
                if (!this.can_be_rendered) {
                    return;
                };
                this.$el.html(_.template($('#calculation-table-template').html(),
                                         { calculations: this.calculations.models }));
            }
        });

    var Calculation = Backbone.Model.extend({
        defaults: {
            map: null,
            layers: []
        }
    });

    var Calculations = Backbone.Collection.extend(
        {
            model: Calculation,
            url: gem_oq_server_url + "/v1/calc/list"
        });
    var calculations = new Calculations();

    var refresh_calcs;

    function populateTrtSelector(selected_trt) {
        $('#trt').empty();
        var trts = $('#mosaic_model').find(':selected').data('value').split(',');
        $.each(trts, function(index, trt) {
            var selected = '';
            if (selected_trt && trt == selected_trt) {
                selected = ' selected';
            }
            $('#trt').append('<option value="' + trt + '"' + selected + '>' + trt + '</option>');
        });
    }

    function setTimer() {
        refresh_calcs = setInterval(function () { calculations.fetch({reset: true}) }, 3000);
    }

    function closeTimer() {
        refresh_calcs = clearInterval(refresh_calcs);
    }

    /* classic event management */
    $(document).ready(
        function () {
            calculation_table = new CalculationTable({ calculations: calculations });
            calculations.fetch({reset: true});
            setTimer();

            if (!disable_version_warning) {
                ajax = $.ajax({url: gem_oq_server_url + "/v1/engine_latest_version",
                              async: true}).done(function (data) {
                                  /* None is returned in case of an error,
                                      but we don't care about errors here */
                                  if(data && data != 'None') {
                                      $('#new-release-box').html(data).show()
                                  }
                              });
            }

            /* XXX. Reset the input file value to ensure the change event
               will be always triggered */
            $(document).on("click", 'input[name=archive]',
                           function (e) { this.value = null; });
            $(document).on("change", 'input[name=archive]',
                           function (e) {
                               dialog.show('Uploading calculation', true);
                               var input = $(e.target);
                               var form = input.parents('form')[0];

                               $(form).ajaxSubmit(
                                   {
                                    xhr: function () {  // custom xhr to add progress bar management
                                        var myXhr = $.ajaxSettings.xhr();
                                        if(myXhr.upload){ // if upload property exists
                                            myXhr.upload.addEventListener('progress', progressHandlingFunction, false);
                                        }
                                        return myXhr;
                                    },
                                    success: function (data) {
                                        calculations.add(new Calculation(data), {at: 0});
                                    },
                                    error: function (xhr) {
                                        dialog.hide();
                                        var s, out, data = $.parseJSON(xhr.responseText);
                                        var out = "";
                                        var ct = 0;
                                        for (s in data) {
                                            if (data[s] == "")
                                                continue;
                                            out += '<p ' + (ct % 2 == 1 ? 'style="background-color: #ffffff;"' : '') + '>' + data[s] + '</p>';
                                            ct++;
                                        }
                                        diaerror.show(false, "Calculation not accepted: traceback", out);
                                    }});
                           });

            $(document).on('hidden.bs.modal', 'div[id^=traceback-]',
                           function (e) {
                               setTimer();
                           });

            // NOTE: if not in aelo mode, aelo_run_form does not exist, so this can never be triggered
            $("#aelo_run_form").submit(function (event) {
                $('#submit_aelo_calc').prop('disabled', true);
                var formData = {
                    lon: $("#lon").val(),
                    lat: $("#lat").val(),
                    vs30: $("#vs30").val().trim() === '' ? '760' : $("#vs30").val(),
                    siteid: $("#siteid").val(),
                    asce_version: $("#asce_version").val()
                };
                $.ajax({
                    type: "POST",
                    url: gem_oq_server_url + "/v1/calc/aelo_run",
                    data: formData,
                    dataType: "json",
                    encode: true,
                }).done(function (data) {
                    // console.log(data);
                }).error(function (data) {
                    var resp = JSON.parse(data.responseText);
                    if ("invalid_inputs" in resp) {
                        for (var i = 0; i < resp.invalid_inputs.length; i++) {
                            var input_id = resp.invalid_inputs[i];
                            $("#aelo_run_form > input#" + input_id).css("background-color", "#F2DEDE");
                        }
                    }
                    var err_msg = resp.error_msg;
                    diaerror.show(false, "Error", err_msg);
                }).always(function () {
                    $('#submit_aelo_calc').prop('disabled', false);
                });
                event.preventDefault();
            });
            $("#aelo_run_form > input").click(function() {
                $(this).css("background-color", "white");
            });

            // NOTE: if not in aristotle mode, aristotle_run_form does not exist, so this can never be triggered
            $("#aristotle_get_rupture_form").submit(function (event) {
                $('#submit_aristotle_get_rupture').prop('disabled', true);
                $('#submit_aristotle_get_rupture').text('Retrieving rupture data...');
                var formData = new FormData();
                formData.append('rupture_file', $('#rupture_file_input')[0].files[0]);
                formData.append('usgs_id', $("#usgs_id").val());
                $.ajax({
                    type: "POST",
                    url: gem_oq_server_url + "/v1/calc/aristotle_get_rupture_data",
                    data: formData,
                    processData: false,
                    contentType: false,
                    encode: true,
                }).done(function (data) {
                    // console.log(data);
                    $('#lon').val(data.lon);
                    $('#lat').val(data.lat);
                    $('#dep').val(data.dep);
                    $('#mag').val(data.mag);
                    $('#rake').val(data.rake);
                    $('#dip').val('dip' in data ? data.dip : '90');
                    $('#strike').val('strike' in data ? data.strike : '0');
                    $('#local_timestamp').val(data.local_timestamp);
                    $('#time_event').val(data.time_event);
                    $('#is_point_rup').val(data.is_point_rup);
                    // NOTE: due to security restrictions in web browsers, it is not possible to programmatically
                    //       set a specific file in an HTML file input element using JavaScript or jQuery,
                    //       therefore we can not pre-populate the rupture_file_input with the rupture_file
                    //       obtained converting the USGS rupture.json, and we use a separate field referencing it
                    $('#rupture_file_from_usgs').val(data.rupture_file_from_usgs);
                    $('#rupture_file_from_usgs_loaded').val(data.rupture_file_from_usgs ? 'Loaded' : 'N.A.');
                    var errors = '';
                    if ('error' in data) {
                        errors += '<p>' + data.error + '</p>';
                        $('#rupture_file_from_usgs_loaded').val('N.A. (conversion error)');
                    }
                    $('#station_data_file_from_usgs').val(data.station_data_file_from_usgs);
                    if (data.station_data_error) {
                        $('#station_data_file_from_usgs_loaded').val('N.A. (conversion error)');
                        errors += '<p>' + data.station_data_error + '</p>';
                    } else {
                        $('#station_data_file_from_usgs_loaded').val(data.station_data_file_from_usgs ? 'Loaded' : 'N.A.');
                    }
                    if (errors != '') {
                        diaerror.show(false, "Error", errors);
                    }
                    if ($('#rupture_file_input')[0].files.length == 1) {
                        $('#dip').prop('disabled', true);
                        $('#strike').prop('disabled', true);
                    }
                    else if (data.is_point_rup) {
                        $('#dip').prop('disabled', false);
                        $('#strike').prop('disabled', false);
                        $('#dip').val('90');
                        $('#strike').val('0');
                    } else {
                        $('#dip').prop('disabled', true);
                        $('#strike').prop('disabled', true);
                        $('#dip').val('');
                        $('#strike').val('');
                    }
                    $('#mosaic_model').empty();
                    $.each(data.mosaic_models, function(index, mosaic_model) {
                        var selected = '';
                        if ('mosaic_model' in data && mosaic_model == data.mosaic_model) {
                            selected = ' selected';
                        }
                        var mosaic_model_trts = data.trts[mosaic_model];
                        $('#mosaic_model').append('<option value="' + mosaic_model + '" data-value=\'' + mosaic_model_trts + '\'' + selected + '>' + mosaic_model + '</option>');
                    });
                    populateTrtSelector(data.trt);
                    if (data.mmi_map_png) {
                        const imgElement = `<img src="data:image/jpeg;base64,${data.mmi_map_png}" alt="Intensity Map">`;
                        $('#intensity-map').html(imgElement);
                        $('shakemap-image-row').show();
                        $('#intensity-map').show();
                    }
                    else {
                        $('#intensity-map').html('<p>No intensity map available</p>');
                    }
                    if (data.pga_map_png) {
                        const imgElement = `<img src="data:image/jpeg;base64,${data.pga_map_png}" alt="PGA Map">`;
                        $('#pga-map').html(imgElement);
                        $('#shakemap-image-row').show();
                        $('#pga-map').show();
                    }
                    else {
                        $('#pga-map').html('<p>No PGA map available</p>');
                    }
                    // // NOTE: we may want to plot the rupture as a separate image after retrieving rupture data
                    // if (data.rupture_png) {
                    //     const imgElement = `<img src="data:image/jpeg;base64,${data.rupture_png}" alt="Rupture">`;
                    //     $('#rupture_png').html(imgElement);
                    //     $('#shakemap-image-row').show();
                    //     $('#rupture_png').show();
                    // }
                    // else {
                    //     $('#rupture_png').html('<p>No rupture image available</p>');
                    // }
                }).error(function (data) {
                    var resp = JSON.parse(data.responseText);
                    if ("invalid_inputs" in resp) {
                        for (var i = 0; i < resp.invalid_inputs.length; i++) {
                            var input_id = resp.invalid_inputs[i];
                            $("#aristotle_get_rupture_form > input#" + input_id).css("background-color", "#F2DEDE");
                        }
                    }
                    var err_msg = resp.error_msg;
                    diaerror.show(false, "Error", err_msg);
                    $('#intensity-map').hide();
                    $('#pga-map').hide();
                    // $('#rupture_png').hide();
                    $('#shakemap-image-row').hide();
                }).always(function () {
                    $('#submit_aristotle_get_rupture').prop('disabled', false);
                    $('#submit_aristotle_get_rupture').text('Retrieve rupture data');
                });
                event.preventDefault();
            });
            $('#mosaic_model').change(function() {
                populateTrtSelector();
            });
            $('#clearRuptureFile').click(function() {
                $('#rupture_file_input').val('');
                $('#dip').prop('disabled', false);
                $('#strike').prop('disabled', false);
                $('#dip').val('90');
                $('#strike').val('0');
            });
            $('#rupture_file_input').on('change', function() {
                $('#dip').prop('disabled', $(this).val() != '');
                $('#strike').prop('disabled', $(this).val() != '');
            });
            $('#clearStationDataFile').click(function() {
                $('#station_data_file_input').val('');
                $('#maximum_distance_stations').val('');
                $('#maximum_distance_stations').prop('disabled', true);
            });
            $("#aristotle_run_form > input").click(function() {
                $(this).css("background-color", "white");
            });
            $("#aristotle_run_form").submit(function (event) {
                $('#submit_aristotle_calc').prop('disabled', true);
                $('#submit_aristotle_calc').text('Processing...');
                var formData = new FormData();
                formData.append('rupture_file_from_usgs', $('#rupture_file_from_usgs').val());
                formData.append('rupture_file', $('#rupture_file_input')[0].files[0]);
                formData.append('usgs_id', $("#usgs_id").val());
                formData.append('lon', $("#lon").val());
                formData.append('lat', $("#lat").val());
                formData.append('dep', $("#dep").val());
                formData.append('mag', $("#mag").val());
                formData.append('rake', $("#rake").val());
                formData.append('dip', $("#dip").val());
                formData.append('strike', $("#strike").val());
                formData.append('is_point_rup', $("#is_point_rup").val());
                formData.append('time_event', $("#time_event").val());
                formData.append('maximum_distance', $("#maximum_distance").val());
                formData.append('mosaic_model', $('#mosaic_model').val());
                formData.append('trt', $('#trt').val());
                formData.append('truncation_level', $('#truncation_level').val());
                formData.append('number_of_ground_motion_fields',
                                $('#number_of_ground_motion_fields').val());
                formData.append('asset_hazard_distance', $('#asset_hazard_distance').val());
                formData.append('ses_seed', $('#ses_seed').val());
                formData.append('station_data_file_from_usgs', $('#station_data_file_from_usgs').val());
                formData.append('local_timestamp', $("#local_timestamp").val());
                formData.append('station_data_file', $('#station_data_file_input')[0].files[0]);
                formData.append('maximum_distance_stations', $("#maximum_distance_stations").val());
                $.ajax({
                    type: "POST",
                    url: gem_oq_server_url + "/v1/calc/aristotle_run",
                    data: formData,
                    processData: false,
                    contentType: false,
                    encode: true
                }).done(function (data) {
                    console.log(data);
                }).error(function (data) {
                    var resp = JSON.parse(data.responseText);
                    if ("invalid_inputs" in resp) {
                        for (var i = 0; i < resp.invalid_inputs.length; i++) {
                            var input_id = resp.invalid_inputs[i];
                            $("#aristotle_run_form > input#" + input_id).css("background-color", "#F2DEDE");
                        }
                    }
                    var err_msg = resp.error_msg;
                    diaerror.show(false, "Error", err_msg);
                }).always(function () {
                    $('#submit_aristotle_calc').prop('disabled', false);
                    $('#submit_aristotle_calc').text('Submit');
                });
                event.preventDefault();
            });
            $("#aristotle_run_form > input").click(function() {
                $(this).css("background-color", "white");
            });
            $('#station_data_file_input').on('change', function() {
                if ($(this).get(0).files.length > 0) {
                    $('#maximum_distance_stations').prop('disabled', false);
                } else {
                    $('#maximum_distance_stations').prop('disabled', true);
                }
            });
        });
})($, Backbone, _, gem_oq_server_url);
