use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

// "Public sites only": every address a host resolves to must be a public unicast address, checked
// after DNS so a name pointing at 127.0.0.1 or a cloud metadata address does not get through.

fn v4_public(ip: Ipv4Addr) -> bool {
    let [a, b, _, _] = ip.octets();
    let private = ip.is_private() // 10/8, 172.16/12, 192.168/16
        || ip.is_loopback() // 127/8
        || ip.is_link_local() // 169.254/16, metadata at 169.254.169.254
        || ip.is_unspecified() // 0.0.0.0
        || ip.is_broadcast()
        || ip.is_multicast()
        || ip.is_documentation()
        || a == 0 // 0/8, "this network"
        || (a == 100 && (64..=127).contains(&b)) // 100.64/10, CGNAT
        || (a == 192 && b == 0 && ip.octets()[2] == 0) // 192.0.0/24, IETF protocol assignments
        || (a == 198 && (18..=19).contains(&b)) // 198.18/15, benchmarking
        || a >= 240; // 240/4, reserved
    !private
}

fn v6_public(ip: Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return v4_public(v4);
    }
    let first = ip.segments()[0];
    let private = ip.is_loopback() // ::1
        || ip.is_unspecified() // ::
        || ip.is_multicast()
        || (first & 0xfe00) == 0xfc00 // fc00::/7, unique local
        || (first & 0xffc0) == 0xfe80 // fe80::/10, link local
        || (first & 0xffc0) == 0xfec0 // fec0::/10, old site local
        || first == 0x2001 && ip.segments()[1] == 0x0db8 // documentation
        || first == 0x0064 && ip.segments()[1] == 0xff9b // 64:ff9b::/96, NAT64 to any v4
        || first == 0; // ::/16 other than the mapped form handled above
    !private
}

pub fn public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4_public(v4),
        IpAddr::V6(v6) => v6_public(v6),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(s: &str) -> bool {
        public(s.parse().unwrap())
    }

    #[test]
    fn only_public_unicast_addresses_pass() {
        for blocked in [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "100.127.255.255",
            "0.0.0.0",
            "255.255.255.255",
            "224.0.0.1",
            "198.18.0.1",
            "::1",
            "::",
            "fc00::1",
            "fd12:3456::1",
            "fe80::1",
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
            "64:ff9b::a00:1",
            "2001:db8::1",
        ] {
            assert!(!ok(blocked), "{blocked} passed");
        }
        for open in [
            "1.1.1.1",
            "8.8.8.8",
            "100.63.255.255",
            "172.32.0.1",
            "2606:4700::1111",
            "::ffff:1.1.1.1",
        ] {
            assert!(ok(open), "{open} was blocked");
        }
    }
}
