<?php
require_once('../../wp-config.php');
?>

<?php
	global $current_user;
	get_currentuserinfo();
	
	$currentUser = array(
		"ID"=>$current_user->ID,
		'login'=>$current_user->user_login,
		'email'=>$current_user->user_email,
		'firstName'=>$current_user->user_firstname,
		'lastName'=>$current_user->user_lastname,
		'displayName'=>$current_user->display_name,
		'avatar'=>get_avatar($current_user->ID, 90),
		'editor'=>current_user_can('editor'),
		'administrator'=>current_user_can('administrator')
	);
	
	echo json_encode($currentUser);
?>
