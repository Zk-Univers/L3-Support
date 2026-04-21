#!/bin/bash

#set log
log_filename=/root/FEP/cfg/edge-scripts-log/edge_ntpupdate.log
error_log_filename=/root/FEP/cfg/edge-scripts-log/error.log
# log_max_size=1000k

#set ntp_config
ntp_config="/root/FEP/cfg/edge-cfg/ntp_config"
current='cn.pool.ntp.org'

#network status
net_status_file="/root/FEP/cfg/edge-tmp/edge_network_status"

#set env
exist=$(echo "$PATH" | grep "/root/FEP/cfg/edge-third-bin" -c)
if [ "$exist" -eq 0 ]; then
    export PATH=$PATH:/root/FEP/cfg/edge-third-bin
fi

exist=$(echo "$LD_LIBRARY_PATH" | grep "/root/FEP/cfg/edge-third-lib" -c)
if [ "$exist" -eq 0 ]; then
    export LD_LIBRARY_PATH=/root/FEP/cfg/edge-third-lib:$LD_LIBRARY_PATH
fi

exist=$(echo "$PATH" | grep "/root/FEP/cfg/edge-tool" -c)
if [ "$exist" -eq 0 ]; then
    export PATH=/root/FEP/cfg/edge-tool:$PATH
fi

## ntpdate cmd path
ntpdate_cmd=$(which ntpdate)
#ntpdate_cmd=/root/FEP/cfg/edge-third-bin/ntpdate

# delete too large log
# check_log_file() {
#     deletelog=$(find /root/FEP/cfg/ -name edge_ntpupdate.log -size +$log_max_size)
#     if [[ $deletelog ]]; then
#         echo $(date "+%Y-%m-%d %H:%M:%S")' find '$deletelog'' >>$log_filename
#         if [ -f $log_filename".1" ]; then
#             rm -rf $log_filename".1"
#         fi
#         mv $log_filename $log_filename".1"
#         echo >$log_filename
#     fi
# }

# print_log() {
#     echo $(date "+%Y-%m-%d %H:%M:%S") $1
#     echo $(date "+%Y-%m-%d %H:%M:%S") $1 >> $log_filename
# }

#get ntp config
func_get_ntp_config() {
    if test -e /root/FEP/cfg/edge-cfg/ntp_config; then
        eval "$(grep </root/FEP/cfg/edge-cfg/ntp_config -E current)"
        xos_log_info $log_filename "read ntp_config, ntp server=$current"
    else
        echo "missing file /root/FEP/cfg/edge-cfg/ntp_config, use default ntp server: $current"
        xos_log_error $log_filename "missing file /root/FEP/cfg/edge-cfg/ntp_config, use default ntp server: $current"
        xos_log_error $error_log_filename "(edge_ntpupdate.sh) missing file /root/FEP/cfg/edge-cfg/ntp_config, use default ntp server: $current"
        #exit
    fi
}

func_update_rtc() {
    xos_log_info $log_filename "try to sync hardware clock by $ntpdate_cmd, current hwclock: $(hwclock --localtime)"
    $ntpdate_cmd $current
    if [ "$?" != "0" ]; then
        #sleep 5
        xos_log_warn $log_filename "ntpdate failed, ntp server: $current, hwclock: $(hwclock --localtime)"
        #xos_log_error $error_log_filename "(edge_ntpupdate.sh) ntpdate failed, ntp server: $current, hwclock: $(hwclock --localtime)"
        return 1
    else
        #sleep 5
        hwclock --localtime --systohc
        xos_log_info $log_filename "finished updating time from $current, hwclock: $(hwclock), hwclock --localtime: $(hwclock --localtime)"
        return 0
    fi
}

func_get_network_status() {
    if [ -e $net_status_file ]; then
        net_status=$(grep <$net_status_file -E "net_status" | awk -F "=" '{print $2}')
    else
        net_status=0
    fi
    #echo $net_status to $net_led_ctl_file
    if [ "$net_status" -eq 1 ]; then
        echo 1
    else
        echo 0
    fi

}

function processDefaultNtpDomain() {
    sed -i "s/^current='cn.pool.ntp.org'$/current='pool.ntp.org'/g" $ntp_config
}

func_cycle_update() {
    local sleep_time=$1
    local max_count=$2
    local count=0

    while true; do
        func_get_ntp_config
        status=$(func_get_network_status)
        xos_log_info $log_filename "network status=$status"

        if func_update_rtc && [ "$status" -eq 1 ]; then
            ((count++))
            if [ $count -ge "$max_count" ]; then
                return 1
            fi
        fi
        xos_log_info $log_filename "sleep ${sleep_time}s after ntp update,count=$count"
        sleep "$sleep_time"
    done
}

curtailment_is_configured() {
    local ied_file="/root/FEP/eoshare/config/fe_config_data/ied_info.xml"
    local curtailment_protocal_name="CurtailmentFilePull"

    [ ! -f "$ied_file" ] && return 1

    if grep $curtailment_protocal_name $ied_file >/dev/null 2>&1; then
        return 0
    fi

    return 1
}

curtailment_get_ntp_time() {
    local ied_file="/root/FEP/eoshare/config/fe_config_data/ied_info.xml"
    local curtailment_protocal_name="CurtailmentFilePull"
    local protocol_sys_file
    local power_plant_id_name="POWER_PLANT_ID"
    local plant_id
    local time_zone_name="TIME_ZONE"

    [ ! -f "$ied_file" ] && return 1

    if curtailment_is_configured; then
        protocol_sys_file=$(grep $curtailment_protocal_name $ied_file | grep -o 'protocol_sys_path="[^"]*"' | sed 's/protocol_sys_path="//;s/"//')
        # xos_log_debug $log_filename "it's configured with $curtailment_protocal_name protocol in $ied_file"
        if [ ! -f "$protocol_sys_file" ]; then
            xos_log_warn $log_filename "missing file $protocol_sys_file, skip curtailment server ntp"
            return 1
        fi

        curtailment_time_zone=$(grep "$time_zone_name" "$protocol_sys_file" | awk '{print $2}')
        plant_id=$(grep "$power_plant_id_name" "$protocol_sys_file" | awk '{print $2}' | rev | cut -c 1)

        if [ ! "$curtailment_time_zone" ] || [ ! "$plant_id" ]; then
            xos_log_warn $log_filename "missing $power_plant_id_name or $time_zone_name in $protocol_sys_file, skip curtailment server ntp"
            return 1
        fi
        # xos_log_debug $log_filename "curtailment_time_zone=$curtailment_time_zone, plant_id=$plant_id"

        case $plant_id in
        0)
            curtailment_ntp_start_time="21:00:00"
            curtailment_ntp_end_time="21:09:59"
            ;;
        1)
            curtailment_ntp_start_time="21:30:00"
            curtailment_ntp_end_time="21:39:59"
            ;;
        2)
            curtailment_ntp_start_time="22:00:00"
            curtailment_ntp_end_time="22:09:59"
            ;;
        3)
            curtailment_ntp_start_time="22:30:00"
            curtailment_ntp_end_time="22:39:59"
            ;;
        4)
            curtailment_ntp_start_time="23:00:00"
            curtailment_ntp_end_time="23:09:59"
            ;;
        5)
            curtailment_ntp_start_time="23:30:00"
            curtailment_ntp_end_time="23:39:59"
            ;;
        6)
            curtailment_ntp_start_time="00:00:00"
            curtailment_ntp_end_time="00:09:59"
            ;;
        7)
            curtailment_ntp_start_time="00:30:00"
            curtailment_ntp_end_time="00:39:59"
            ;;
        8)
            curtailment_ntp_start_time="01:00:00"
            curtailment_ntp_end_time="01:09:59"
            ;;
        9)
            curtailment_ntp_start_time="01:30:00"
            curtailment_ntp_end_time="01:39:59"
            ;;
        *)
            xos_log_warn $log_filename "invalid plant id $plant_id, skip curtailment server ntp"
            return 1
            ;;
        esac

        return 0
    fi

    return 1
}

curtailment_within_time_range() {
    if ! curtailment_get_ntp_time; then
        return 1
    fi

    local fmt="now"
    local tz
    local hours
    local minutes
    local current_local_time_s
    local curtailment_ntp_start_time_s
    local curtailment_ntp_end_time_s

    #convert time using configured time_zone, decimal part
    if [ $(echo "$curtailment_time_zone % 1 != 0" | bc) -eq 1 ]; then
        if [ $(echo "$curtailment_time_zone < 0" | bc) -eq 1 ]; then
            tz=$(echo "scale=1; -1*$curtailment_time_zone" | bc)
            hours=$(echo "$tz" | cut -d '.' -f 1)
            minutes=$(echo "scale=0; ($tz- $hours) * 60 / 1" | bc)
            fmt=${fmt}" - $hours hours $minutes minutes"
        else
            tz=$curtailment_time_zone
            hours=$(echo "$tz" | cut -d '.' -f 1)
            minutes=$(echo "scale=0; ($tz- $hours) * 60 / 1" | bc)
            fmt=${fmt}" + $hours hours $minutes minutes"
        fi
    else
        if [ $(echo "$curtailment_time_zone < 0" | bc) -eq 1 ]; then
            fmt=${fmt}" - $curtailment_time_zone hours"
        else
            fmt=${fmt}" + $curtailment_time_zone hours"
        fi
    fi

    current_local_time=$(date +%T -d "$fmt")
    if [ "$current_local_time" ]; then
        # xos_log_debug $log_filename "current local time=$current_local_time, curtailment_ntp_start_time=$curtailment_ntp_start_time, curtailment_ntp_end_time=$curtailment_ntp_end_time"
        current_local_time_s=$(date -ud "$current_local_time" +%s)
        curtailment_ntp_start_time_s=$(date -ud "$curtailment_ntp_start_time" +%s)
        curtailment_ntp_end_time_s=$(date -ud "$curtailment_ntp_end_time" +%s)
        if [ "$current_local_time_s" -ge "$curtailment_ntp_start_time_s" ] && [ "$current_local_time_s" -le "$curtailment_ntp_end_time_s" ]; then
            # xos_log_debug $log_filename "current local time is in curtailment time range"
            return 0
        fi

        return 1
    fi

    return 1
}

main() {
    xos_log_info $log_filename "**** start edge_ntpupdate.sh ****"
    local last_within_time_range=0
    local sleep_total_time=86400
    local curtailment_sleep_total_time=0
    local curtailment_ntp_count=0
    local sleep_time=60

    processDefaultNtpDomain

    if [ -n "$(kversion)" ]; then
        if [[ "$(systemctl is-enabled ntp 2>/dev/null)" == *"enable"* ]]; then
            systemctl disable ntp
            systemctl stop ntp
            xos_log_info $log_filename "disable and stop service ntp"
        fi
    fi

    func_cycle_update 30 3
    # sync time periodically
    while true; do
        if curtailment_is_configured; then
            if curtailment_within_time_range; then
                if [ "$last_within_time_range" -eq 1 ]; then
                    sleep $sleep_time
                    continue
                fi
                last_within_time_range=1

                func_get_ntp_config
                if func_update_rtc; then
                    xos_log_info $log_filename "it's configured with curtailment and within time range, ntp update success"
                    sleep $sleep_time
                else
                    curtailment_ntp_count=0
                    curtailment_sleep_total_time=0
                    while true; do
                        sleep $sleep_time
                        [ "$curtailment_ntp_count" -ge 5 ] && curtailment_sleep_total_time=$((curtailment_sleep_total_time + sleep_time))

                        if ! curtailment_is_configured; then
                            break
                        fi

                        if [ "$curtailment_ntp_count" -lt 5 ] || [ "$curtailment_sleep_total_time" -ge 1800 ]; then
                            func_get_ntp_config
                            if func_update_rtc; then
                                xos_log_info $log_filename "it's configured with curtailment, ntp update success, retried count=$curtailment_ntp_count"
                                break
                            else
                                curtailment_ntp_count=$((curtailment_ntp_count + 1))
                                [ "$curtailment_sleep_total_time" -ge 1800 ] && curtailment_sleep_total_time=0
                                xos_log_warn $log_filename "it's configured with curtailment, ntp update failed, count=$curtailment_ntp_count"
                            fi
                        fi
                    done
                fi
            else
                last_within_time_range=0
            fi
            sleep $sleep_time
        else
            if [ "$sleep_total_time" -ge 600 ]; then
                xos_log_info $log_filename "sleep 1 day after ntp update"
                func_get_ntp_config
                func_update_rtc
                sleep_total_time=0
            fi
            sleep $sleep_time
            sleep_total_time=$((sleep_total_time + sleep_time))
        fi
    done
}

main
