<?php
require_once('../../wp-config.php');
require_once('../../wp-includes/wp-db.php');
?>
<?php
	$eventType = $_POST['eventType'];
	$eventKey = $_POST['eventKey'];
	$eventData = $_POST['eventData'];
	
	$userID = $current_user->ID;
	$userLogin = $current_user->user_login;
	$hostAddress = getClientIPAddress();
	
	$wpdb->query($wpdb->prepare("CALL create_user_activity_log_entry(%s, %d, %s, %d, %s, %s)", $eventType, $eventKey, $eventData, $userID, $userLogin, $hostAddress));
	
	function getClientIPAddress()
	{
		if (!empty($_SERVER['HTTP_CLIENT_IP']))
		{
			$ip = $_SERVER['HTTP_CLIENT_IP'];
		}
		elseif (!empty($_SERVER['HTTP_X_FORWARDED_FOR']))
		{
			// Client is behind a proxy
			$ip=$_SERVER['HTTP_X_FORWARDED_FOR'];
		}
		else
		{
			$ip=$_SERVER['REMOTE_ADDR'];
		}
		
		return $ip;
	}
?>
